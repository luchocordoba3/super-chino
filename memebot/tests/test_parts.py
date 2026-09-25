from types import SimpleNamespace

import pytest
from pydantic import BaseModel, ValidationError
from pytest import approx
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.token.associated import get_associated_token_address

from memebot.agents.llm import BudgetExceeded, ClaudeLLM
from memebot.agents.risk import RiskDecision, enforce_limits
from memebot.chain import TOKEN_PROGRAM, usdc_transfer_instructions, usdc_transfer_tx
from memebot.config import parse_config
from memebot.goals import apply_milestones, crossed_milestones
from memebot.market import SOL_MINT, USDC_MINT, best_pairs, dexscreener_mints, gecko_mints
from memebot.models import State
from memebot.safety import evaluate_mint, evaluate_rugcheck
from memebot.scanner import reject_reason, score

from .conftest import NOW, cfg_with, metrics

# ---- metas y retiros -------------------------------------------------------------------------


def test_recorrido_completo_de_metas_desde_mil_dolares():
    cfg = cfg_with()
    s = State.fresh("paper", 1000, NOW)
    for equity_needed, withdraw in [
        (100_000, 49_500),
        (250_500, 100_000),
        (450_500, 150_000),
        (700_500, 200_000),
        (1_000_500, 250_000),
    ]:
        r = crossed_milestones(s, equity_needed, cfg)
        assert len(r.crossed) == 1 and r.withdraw_usd == approx(withdraw)
        apply_milestones(s, equity_needed, r)
        s.withdrawn_usd += s.pending_withdrawal_usd  # se paga el retiro
        s.pending_withdrawal_usd = 0
    assert s.withdrawn_usd == approx(749_500)
    assert crossed_milestones(s, 1_000_500 - 250_000, cfg).crossed == []


def test_varias_metas_juntas_hacen_un_solo_retiro():
    s = State.fresh("paper", 1000, NOW)
    r = crossed_milestones(s, 350_000, cfg_with())
    assert r.crossed == [100_000, 300_000]
    assert r.withdraw_usd == approx(174_500)


# ---- risk manager, IA y configuración ---------------------------------------------------------


def test_los_topes_duros_recortan_la_decision():
    d = RiskDecision(
        approve=True, size_pct=80, stop_loss_pct=1, trailing_stop_pct=90, max_hold_minutes=100_000, rationale=""
    )
    c = enforce_limits(d, cfg_with())
    assert (c.size_pct, c.stop_loss_pct, c.trailing_stop_pct, c.max_hold_minutes) == (5, 5, 60, 24 * 60)


class _Out(BaseModel):
    ok: bool


def _fake_client(model_served: str):
    calls = []

    def parse(**kw):
        calls.append(kw)
        usage = SimpleNamespace(
            input_tokens=10_000, output_tokens=2_000, cache_creation_input_tokens=0, cache_read_input_tokens=0
        )
        return SimpleNamespace(model=model_served, usage=usage, stop_reason="end_turn", parsed_output=_Out(ok=True))

    client = SimpleNamespace(
        messages=SimpleNamespace(parse=parse), beta=SimpleNamespace(messages=SimpleNamespace(parse=parse))
    )
    return client, calls


def test_llm_opus_usa_respaldo_y_registra_el_costo():
    client, calls = _fake_client("claude-opus-5")
    s = State.fresh("paper", 1000, NOW)
    llm = ClaudeLLM(client, s, daily_budget_usd=1, now=lambda: NOW)
    out = llm.ask(agent="director", model="claude-opus-5", effort="medium", system="s", prompt="p", schema=_Out)
    assert out.ok
    assert calls[0]["fallbacks"] == "default" and calls[0]["betas"] == ["server-side-fallback-2026-07-01"]
    assert calls[0]["output_config"] == {"effort": "medium"}
    assert s.llm_spent_today_usd == approx(0.1)  # 10k × $5/M + 2k × $25/M


def test_llm_respeta_el_presupuesto_diario_y_lo_renueva_cada_dia():
    client, calls = _fake_client("claude-sonnet-5")
    s = State.fresh("paper", 1000, NOW)
    clock = [NOW]
    llm = ClaudeLLM(client, s, daily_budget_usd=0.05, now=lambda: clock[0])
    llm.ask(agent="quant", model="claude-sonnet-5", effort="medium", system="s", prompt="p", schema=_Out)
    assert "fallbacks" not in calls[0]
    assert s.llm_spent_today_usd == approx(0.04)
    llm.ask(agent="quant", model="claude-sonnet-5", effort="medium", system="s", prompt="p", schema=_Out)
    with pytest.raises(BudgetExceeded):
        llm.ask(agent="quant", model="claude-sonnet-5", effort="medium", system="s", prompt="p", schema=_Out)
    clock[0] += 24 * 3600
    llm.ask(agent="quant", model="claude-sonnet-5", effort="medium", system="s", prompt="p", schema=_Out)
    assert s.llm_spent_total_usd == approx(0.12)


def test_configuracion():
    c = parse_config({"MILESTONES_USD": "1000, 5000", "TARGET_USD": "9000", "MODE": ""})
    assert c.MILESTONES_USD == [1000, 5000] and c.MODE == "paper"
    assert parse_config({}).MILESTONES_USD == [100_000, 300_000, 600_000, 1_000_000, 1_500_000]
    defaults = parse_config({})
    assert defaults.TARGET_USD == 2_000_000
    # Muchas apuestas chicas: 5% por compra, hasta 8 posiciones, vende la mitad al duplicar.
    assert (defaults.MAX_POSITION_PCT, defaults.MAX_POSITIONS, defaults.TAKE_PROFIT_PCT) == (5, 8, 100)
    with pytest.raises(ValidationError):
        parse_config({"MILESTONES_USD": "300000,100000"})
    with pytest.raises(ValidationError):
        parse_config({"MILESTONES_USD": "3000000"})


# ---- escáner ------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "overrides, reason",
    [
        ({"liquidity_usd": 10_000}, "liquidez baja"),
        ({"volume_h1": 20_000}, "poco volumen"),
        ({"created_at": NOW - 600}, "demasiado nueva"),
        ({"created_at": NOW - 100 * 3600}, "demasiado vieja"),
        ({"market_cap_usd": 50_000_000}, "capitalización fuera de rango"),
        ({"sells_m5": 200}, "no dominan las compras"),
        ({"change_m5": -1}, "sin impulso a 5 min"),
    ],
)
def test_filtros_del_escaner(overrides, reason):
    cfg = cfg_with()
    assert reject_reason(metrics("a"), cfg, NOW) is None
    assert reject_reason(metrics("a", **overrides), cfg, NOW) == reason


def test_puntaje():
    cfg = cfg_with()
    strong, weak = score(metrics("a"), cfg), score(metrics("b", buys_m5=70, sells_m5=50, volume_m5=10_000), cfg)
    assert 0 <= weak < strong <= 1


# ---- fuentes de datos y controles anti-estafa --------------------------------------------------


def _pair(**o):
    base = {
        "chainId": "solana",
        "dexId": "raydium",
        "pairAddress": "P1",
        "baseToken": {"address": "MEME", "name": "Meme", "symbol": "MEME"},
        "quoteToken": {"address": SOL_MINT, "symbol": "SOL"},
        "priceNative": "0.00001",
        "priceUsd": "0.0015",
        "txns": {"m5": {"buys": 30, "sells": 10}, "h1": {"buys": 300, "sells": 150}},
        "volume": {"h24": 1_000_000, "h6": 500_000, "h1": 100_000, "m5": 20_000},
        "priceChange": {"m5": 3.2, "h1": 45, "h6": 120, "h24": 300},
        "liquidity": {"usd": 80_000, "base": 1, "quote": 2},
        "fdv": 1_500_000,
        "marketCap": 1_400_000,
        "pairCreatedAt": 1_758_800_000_000,
    }
    return {**base, **o}


def test_dexscreener_elige_el_mejor_par_y_descarta_incompletos():
    payload = [
        _pair(),
        _pair(pairAddress="P2", quoteToken={"address": USDC_MINT}, liquidity={"usd": 120_000}, priceUsd="0.0016"),
        _pair(pairAddress="P3", quoteToken={"address": "OTRA"}, liquidity={"usd": 999_999}),
        _pair(pairAddress="P4", chainId="base", liquidity={"usd": 999_999}),
        {k: v for k, v in _pair(baseToken={"address": "ROTA"}).items() if k != "priceUsd"},
    ]
    out = best_pairs(payload)
    assert list(out) == ["MEME"]
    m = out["MEME"]
    assert (m.price_usd, m.liquidity_usd, m.buys_m5, m.volume_h1, m.created_at) == (
        0.0016,
        120_000,
        30,
        100_000,
        1_758_800_000,
    )
    assert len(best_pairs({"pairs": [_pair()]})) == 1 and best_pairs(None) == {}


def test_listas_de_monedas():
    assert dexscreener_mints(
        [{"chainId": "solana", "tokenAddress": "A"}, {"chainId": "ethereum", "tokenAddress": "B"}, 3]
    ) == ["A"]
    gecko = {"data": [{"relationships": {"base_token": {"data": {"id": "solana_MEME"}}}}, {"id": "raro"}]}
    assert gecko_mints(gecko) == ["MEME"] and gecko_mints({}) == []


def _mint(program="spl-token", **info):
    base = {"decimals": 6, "supply": "1000", "isInitialized": True, "mintAuthority": None, "freezeAuthority": None}
    return {"program": program, "parsed": {"type": "mint", "info": {**base, **info}}}


@pytest.mark.parametrize(
    "data, reason",
    [
        (_mint(mintAuthority="X"), "alguien puede emitir más monedas"),
        (_mint(freezeAuthority="X"), "alguien puede congelar monedas"),
        (
            _mint("spl-token-2022", extensions=[{"extension": "transferFeeConfig", "state": {}}]),
            "extensión peligrosa: transferFeeConfig",
        ),
        (
            _mint(
                "spl-token-2022", extensions=[{"extension": "defaultAccountState", "state": {"accountState": "frozen"}}]
            ),
            "extensión peligrosa: defaultAccountState",
        ),
        ({"parsed": {"type": "account", "info": {}}}, "no es un token"),
        ({"parsed": {"type": "mint", "info": {"decimals": 6}}}, "datos del token ilegibles"),
        (None, "no es un token"),
    ],
)
def test_controles_del_mint(data, reason):
    r = evaluate_mint(data)
    assert not r.ok and r.reason == reason


def test_mint_limpio_y_rugcheck():
    assert evaluate_mint(_mint()).decimals == 6
    assert evaluate_mint(_mint("spl-token-2022", extensions=[{"extension": "metadataPointer"}])).ok
    ok = evaluate_rugcheck({"risks": [{"name": "Low Liquidity", "level": "warn"}]})
    assert ok.ok and ok.warnings == ["Low Liquidity"]
    bad = evaluate_rugcheck({"risks": [{"name": "Freeze Authority still enabled", "level": "danger"}]})
    assert not bad.ok and bad.reason == "RugCheck: Freeze Authority still enabled"
    assert not evaluate_rugcheck({}).ok


def test_transferencia_de_usdc_para_retiros():
    kp, dest = Keypair(), Keypair().pubkey()
    usdc = Pubkey.from_string(USDC_MINT)
    _priority, create, transfer = usdc_transfer_instructions(kp.pubkey(), dest, 1_500_000)
    assert create.accounts[1].pubkey == get_associated_token_address(dest, usdc)
    assert transfer.program_id == TOKEN_PROGRAM
    assert transfer.data == bytes([12]) + (1_500_000).to_bytes(8, "little") + bytes([6])
    assert transfer.accounts[0].pubkey == get_associated_token_address(kp.pubkey(), usdc)
    assert transfer.accounts[3].pubkey == kp.pubkey() and transfer.accounts[3].is_signer
    tx = usdc_transfer_tx(kp, dest, 1_500_000, "11111111111111111111111111111111")
    assert tx.verify_with_results() == [True]
