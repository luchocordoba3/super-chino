from pytest import approx

from memebot.agents.director import DirectorReport
from memebot.bot import Bot

from .conftest import CYCLE, TICK, close, thesis


def with_thesis(env, *mints):
    env.llm.director = DirectorReport(market_view="", theses=[thesis(m) for m in mints], close_positions=[])


def test_director_quant_risk_y_ejecucion(make_env):
    env = make_env()
    env.market.set("aaa")
    with_thesis(env, "aaa")
    env.tick()
    assert env.llm.calls == ["director", "quant", "risk"]
    [p] = env.state.positions
    assert p.cost_usd == approx(200)  # 20% de 1000, lo que decidió el risk manager
    assert p.plan.take_profit_pct == 100  # vende la mitad al duplicar
    assert env.journal.data.observations["aaa"].stage == "comprada"
    assert p.plan.stop_loss_pct == 20
    assert p.thesis.startswith("volumen")
    assert env.store.load() == env.state


def test_si_el_quant_rechaza_no_se_llama_al_risk_ni_se_compra(make_env):
    env = make_env()
    env.market.set("aaa")
    with_thesis(env, "aaa")
    env.llm.quant.approved = False
    env.tick()
    assert env.llm.calls == ["director", "quant"]
    assert env.state.positions == []


def test_un_mint_inventado_por_el_director_se_descarta(make_env):
    env = make_env()
    env.market.set("aaa")
    with_thesis(env, "inventado")
    env.tick()
    assert env.llm.calls == ["director"]
    assert env.state.positions == []


def test_el_tamano_se_recorta_al_tope_duro(make_env):
    env = make_env()
    env.market.set("aaa")
    with_thesis(env, "aaa")
    env.llm.risk.size_pct = 90
    env.llm.risk.stop_loss_pct = 80
    env.tick()
    [p] = env.state.positions
    assert p.cost_usd == approx(250)  # MAX_POSITION_PCT = 25
    assert p.plan.stop_loss_pct == 40  # STOP_LOSS_MAX_PCT


def test_sin_candidatas_ni_posiciones_no_se_gasta_en_ia(make_env):
    env = make_env()
    env.market.set("aaa", liquidity_usd=1_000)  # no pasa el escáner
    env.tick()
    assert env.llm.calls == []


def test_descarta_monedas_que_no_pasan_los_controles(make_env):
    from memebot.safety import SafetyReport

    env = make_env()
    env.market.set("aaa")
    env.safety.reports["aaa"] = SafetyReport(False, "alguien puede emitir más monedas")
    with_thesis(env, "aaa")
    env.tick()
    assert env.llm.calls == []  # no llegó ni al director


def test_no_compra_si_el_impacto_en_el_precio_es_alto(make_env):
    env = make_env()
    env.market.set("aaa")
    env.market.impact["aaa"] = 0.1
    with_thesis(env, "aaa")
    env.tick()
    assert env.state.positions == []
    assert env.state.cash_usd == 1000


def test_stop_loss_del_plan_y_enfriamiento(make_env):
    env = make_env()
    env.market.set("aaa")
    with_thesis(env, "aaa")
    env.tick()
    env.market.price("aaa", 0.0079)  # -21%, el plan dice stop en -20%
    env.advance(TICK)
    env.tick()
    assert env.state.positions == []
    assert env.state.cash_usd == approx(800 + 158)
    assert env.state.loss_streak == 1
    [closed] = env.journal.data.closed
    assert closed.exit_reason == "stop-loss" and closed.pnl_pct == approx(-21)
    env.market.price("aaa", 0.01)
    env.advance(CYCLE)
    env.tick()
    assert env.state.positions == []  # no vuelve a entrar en la misma moneda


def test_toma_de_ganancia_y_stop_dinamico(make_env):
    env = make_env()
    env.market.set("aaa")
    with_thesis(env, "aaa")
    env.tick()
    env.market.price("aaa", 0.016)  # +60%: todavía no duplicó
    env.advance(TICK)
    env.tick()
    assert not env.state.positions[0].took_profit
    env.market.price("aaa", 0.021)  # duplicó: vende la mitad
    env.advance(TICK)
    env.tick()
    [p] = env.state.positions
    assert p.took_profit and p.amount_raw == 10_000_000_000
    env.market.price("aaa", 0.03)
    env.advance(TICK)
    env.tick()
    env.market.price("aaa", 0.022)  # cae más de 25% desde el máximo: sale el resto
    env.advance(TICK)
    env.tick()
    assert env.state.positions == []
    assert env.state.cash_usd == approx(800 + 210 + 220)
    assert [t.exit_reason for t in env.journal.data.closed] == ["stop dinámico"]
    assert env.journal.data.closed[0].peak_multiple == approx(3)


def test_el_director_puede_cerrar_una_posicion(make_env):
    env = make_env()
    env.market.set("aaa")
    with_thesis(env, "aaa")
    env.tick()
    env.llm.director = DirectorReport(market_view="", theses=[], close_positions=[close("aaa"), close("otra")])
    env.advance(CYCLE)
    env.tick()
    assert env.state.positions == []


def test_meta_alcanzada_retira_la_mitad_de_la_ganancia(make_env):
    env = make_env(MILESTONES_USD=[2000], TARGET_USD=10_000)
    env.market.set("aaa")
    with_thesis(env, "aaa")
    env.tick()  # compra US$200 en aaa a 0,01
    env.market.price("aaa", 0.1)  # la posición vale US$2000; capital 2800
    env.advance(TICK)
    env.tick()
    s = env.state
    assert s.milestones_hit == [2000]
    # Ganancia 1800 -> retiro 900. Había 800 en efectivo: sale ya; el resto queda pendiente.
    assert s.withdrawn_usd == approx(800)
    assert s.pending_withdrawal_usd == approx(100)
    assert any("Meta alcanzada" in n for n in env.notes)
    env.advance(TICK)
    env.tick()  # la toma de ganancia del ciclo anterior liberó efectivo
    assert s.withdrawn_usd == approx(900)
    assert s.pending_withdrawal_usd == approx(0)
    assert s.profit_base_usd == approx(1900)


def test_objetivo_final_vende_todo_retira_todo_y_no_vuelve_a_operar(make_env):
    env = make_env(MILESTONES_USD=[2000], TARGET_USD=5000)
    env.market.set("aaa")
    with_thesis(env, "aaa")
    env.tick()
    env.market.price("aaa", 0.3)  # 800 + 6000
    env.advance(TICK)
    assert env.tick() is False
    s = env.state
    assert s.status == "won"
    assert s.positions == []
    assert s.withdrawn_usd == approx(6800)
    assert s.cash_usd == approx(0)
    assert any("OBJETIVO FINAL" in n for n in env.notes)
    reloaded = Bot(
        cfg=env.cfg,
        state=env.store.load(),
        store=env.store,
        scanner=env.bot.scanner,
        agents=_agents(env.bot),
        journal=env.journal,
        notify=env.notes.append,
        now=lambda: env.clock[0],
    )
    assert reloaded.tick() is False


def _agents(bot):
    from memebot.bot import Agents

    return Agents(bot.director, bot.quant, bot.risk, bot.execution)


def test_quiebra_vende_lo_que_queda_y_se_apaga(make_env):
    env = make_env(MAX_POSITION_PCT=100, BUST_USD=50)
    env.market.set("aaa")
    with_thesis(env, "aaa")
    env.llm.risk.size_pct = 100
    env.tick()
    assert env.state.cash_usd == approx(0)
    env.market.price("aaa", 0.0001)
    env.advance(TICK)
    assert env.tick() is False
    assert env.state.status == "busted"
    assert env.state.positions == []


def test_nunca_quiebra_si_la_billetera_no_tuvo_capital(make_env):
    env = make_env(cash=0)
    assert env.tick() is True
    assert env.state.status == "running"


def test_sin_presupuesto_de_ia_no_entra_pero_las_salidas_siguen(make_env):
    env = make_env()
    env.market.set("aaa")
    with_thesis(env, "aaa")
    env.tick()
    env.llm.over_budget = True
    env.market.set("bbb")
    env.market.price("aaa", 0.0079)
    env.advance(CYCLE)
    env.tick()
    assert env.state.positions == []  # el stop-loss funcionó sin IA
    assert any("presupuesto" in n for n in env.notes)


def test_boton_de_panico(make_env):
    env = make_env()
    env.market.set("aaa")
    with_thesis(env, "aaa")
    env.tick()
    env.store.set_panic(True)
    env.advance(CYCLE)
    env.tick()
    assert env.state.positions == []
    calls = len(env.llm.calls)
    env.advance(CYCLE)
    env.tick()
    assert len(env.llm.calls) == calls  # en pánico no se consulta a los agentes


def test_la_simulacion_descuenta_comision_y_slippage(make_env):
    env = make_env(PAPER_FEE_USD=0.05, PAPER_SLIPPAGE_PCT=1)
    env.market.set("aaa")
    with_thesis(env, "aaa")
    env.tick()
    [p] = env.state.positions
    assert p.cost_usd == approx(200.05)
    assert p.amount_raw == 19_800_000_000
