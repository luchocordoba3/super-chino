from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pytest

from memebot.agents.director import CloseSignal, Director, DirectorReport, Review, Thesis
from memebot.agents.execution import ExecutionAgent, PaperBroker, Quote
from memebot.agents.llm import BudgetExceeded
from memebot.agents.quant import Quant, QuantVerdict
from memebot.agents.risk import RiskDecision, RiskManager
from memebot.bot import Agents, Bot
from memebot.config import Config, parse_config
from memebot.learning import Journal
from memebot.market import USDC_MINT
from memebot.models import PairMetrics, State
from memebot.safety import SafetyReport
from memebot.scanner import Scanner
from memebot.state import Store

NOW = 1_790_000_000.0
TICK = 15
CYCLE = 15 * 60


def cfg_with(**overrides: Any) -> Config:
    return parse_config({}).model_copy(update=overrides)


def metrics(mint: str, **o: Any) -> PairMetrics:
    """Una moneda que pasa todos los filtros del escáner con la configuración por defecto."""
    base = dict(
        mint=mint,
        symbol=mint.upper(),
        price_usd=0.01,
        liquidity_usd=200_000,
        market_cap_usd=2_000_000,
        volume_m5=50_000,
        volume_h1=300_000,
        volume_h24=2_000_000,
        change_m5=5,
        change_h1=60,
        change_h6=80,
        change_h24=120,
        buys_m5=120,
        sells_m5=60,
        buys_h1=1200,
        sells_h1=600,
        created_at=NOW - 5 * 3600,
    )
    return PairMetrics(**{**base, **o})


class FakeMarket:
    """DexScreener y Jupiter falsos con la misma tabla de precios. Todas las monedas tienen 6 decimales, como USDC."""

    def __init__(self) -> None:
        self.data: dict[str, PairMetrics] = {}
        self.discovered: list[str] = []
        self.impact: dict[str, float] = {}

    def set(self, mint: str, **o: Any) -> None:
        current = self.data.get(mint) or metrics(mint)
        self.data[mint] = current.model_copy(update=o)
        if mint not in self.discovered:
            self.discovered.append(mint)

    def price(self, mint: str, price: float) -> None:
        self.set(mint, price_usd=price)

    def discover(self) -> list[str]:
        return list(self.discovered)

    def metrics(self, mints: list[str]) -> dict[str, PairMetrics]:
        return {m: self.data[m] for m in mints if m in self.data}

    def quote(self, input_mint: str, output_mint: str, amount: int, slippage_bps: int) -> Quote:
        buying = input_mint == USDC_MINT
        token = output_mint if buying else input_mint
        m = self.data.get(token)
        if m is None or m.price_usd <= 0:
            raise RuntimeError("sin ruta")
        out = amount / m.price_usd if buying else amount * m.price_usd
        if buying and amount > 1_000_000:
            out *= 1 - self.impact.get(token, 0)
        return Quote(amount, int(round(out)), {})


class FakeSafety:
    def __init__(self) -> None:
        self.reports: dict[str, SafetyReport] = {}

    def check(self, mint: str) -> SafetyReport:
        return self.reports.get(mint, SafetyReport(True, decimals=6))


@dataclass
class FakeLLM:
    """Respuestas programadas por agente; registra el orden de las llamadas."""

    calls: list[str] = field(default_factory=list)
    prompts: dict[str, list[str]] = field(default_factory=dict)
    director: DirectorReport = field(
        default_factory=lambda: DirectorReport(market_view="", theses=[], close_positions=[])
    )
    quant: QuantVerdict = field(
        default_factory=lambda: QuantVerdict(
            approved=True, confidence=0.7, reasoning="los datos acompañan", red_flags=[]
        )
    )
    risk: RiskDecision = field(
        default_factory=lambda: RiskDecision(
            approve=True,
            size_pct=20,
            stop_loss_pct=20,
            trailing_stop_pct=25,
            max_hold_minutes=120,
            rationale="ok",
        )
    )
    revision: Review = field(default_factory=lambda: Review(summary="sin novedades", lessons=[]))
    over_budget: bool = False

    def ask(self, *, agent: str, schema: Any, prompt: str, **_: Any) -> Any:
        if self.over_budget:
            raise BudgetExceeded("se agotó el presupuesto diario de IA")
        self.calls.append(agent)
        self.prompts.setdefault(agent, []).append(prompt)
        return getattr(self, agent).model_copy(deep=True)


def thesis(mint: str, conviction: float = 0.8) -> Thesis:
    return Thesis(
        mint=mint,
        symbol=mint.upper(),
        thesis="volumen acelerando y compras dominando",
        invalidation="las ventas pasan a dominar",
        conviction=conviction,
        horizon_minutes=90,
    )


def close(mint: str) -> CloseSignal:
    return CloseSignal(mint=mint, reason="la tesis se invalidó")


@dataclass
class Env:
    cfg: Config
    market: FakeMarket
    safety: FakeSafety
    llm: FakeLLM
    store: Store
    journal: Journal
    state: State
    bot: Bot
    notes: list[str]
    clock: list[float]

    def advance(self, seconds: float) -> None:
        self.clock[0] += seconds

    def tick(self) -> bool:
        return self.bot.tick()


@pytest.fixture
def make_env(tmp_path):
    def build(cash: float = 1000, **overrides: Any) -> Env:
        # MAX_POSITION_PCT=25 deja números redondos en los tests de mecánica; los valores por defecto se prueban aparte.
        cfg = cfg_with(**{"PAPER_FEE_USD": 0, "PAPER_SLIPPAGE_PCT": 0, "MAX_POSITION_PCT": 25, **overrides})
        market, safety, llm = FakeMarket(), FakeSafety(), FakeLLM()
        store = Store(str(tmp_path / "data"), "paper")
        state = State.fresh("paper", cash, NOW)
        clock = [NOW]
        now = lambda: clock[0]  # noqa: E731
        journal = Journal(tmp_path / "data" / "learning.json", now=now)
        execution = ExecutionAgent(PaperBroker(market, state, cfg.PAPER_FEE_USD, cfg.PAPER_SLIPPAGE_PCT), cfg)
        agents = Agents(Director(llm, cfg), Quant(llm, cfg), RiskManager(llm, cfg), execution)
        notes: list[str] = []
        bot = Bot(
            cfg=cfg,
            state=state,
            store=store,
            scanner=Scanner(market, safety, execution, cfg, journal=journal, now=now),
            agents=agents,
            journal=journal,
            notify=notes.append,
            now=now,
        )
        return Env(cfg, market, safety, llm, store, journal, state, bot, notes, clock)

    return build
