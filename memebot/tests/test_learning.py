import json

from pytest import approx

from memebot.agents.director import Review
from memebot.learning import Journal

from .conftest import CYCLE, NOW, cfg_with, metrics, thesis


def test_registra_la_primera_vez_y_solo_avanza_de_etapa(tmp_path):
    clock = [NOW]
    j = Journal(tmp_path / "learning.json", now=lambda: clock[0])
    j.observe(metrics("a"), 0.7, "candidata")
    clock[0] += 60
    j.observe(metrics("a", price_usd=0.02), 0.9, "filtrada", "liquidez baja")  # ni retrocede ni cambia la foto
    o = j.data.observations["a"]
    assert (o.stage, o.metrics.price_usd, o.seen_at) == ("candidata", 0.01, NOW)
    j.mark("a", "comprada")
    assert o.stage == "comprada"
    j.mark("desconocida", "tesis")
    assert list(j.data.observations) == ["a"]


def test_seguimiento_revision_y_persistencia(tmp_path):
    cfg = cfg_with(MIN_REVIEW_OBSERVATIONS=3, MAX_LESSONS=2)
    clock = [NOW]
    j = Journal(tmp_path / "learning.json", now=lambda: clock[0])
    for mint in ("gana", "cae", "igual"):
        j.observe(metrics(mint), 0.6, "candidata")
    clock[0] += 3600
    j.track({"gana": 0.05, "cae": 0.002, "igual": 0.011}, cfg)
    assert not j.review_due(cfg)  # todavía no terminó el período de observación
    clock[0] += 24 * 3600
    j.track({"gana": 0.02}, cfg)  # llegó a x5 y bajó a x2; las otras quedan con su último dato
    assert j.review_due(cfg)
    s = j.stats(cfg)
    assert [s["grupos"][g]["cantidad"] for g in ("ganadoras", "desplomadas", "resto")] == [1, 1, 1]
    assert s["ejemplos_ganadoras"][0]["maximo_multiplo"] == 5
    assert s["hasta_donde_llegaron_las_ganadoras"] == {"candidata": 1}
    j.apply_review(["uno", " ", "dos", "tres"], "resumen", cfg)
    assert j.lessons == ["uno", "dos"]  # como máximo MAX_LESSONS, sin vacías
    assert j.data.observations == {}  # lo revisado se descarta; queda en las lecciones
    j.save()
    again = Journal(tmp_path / "learning.json")
    assert again.lessons == ["uno", "dos"] and again.data.last_review_summary == "resumen"


def test_aprende_de_una_ganadora_que_dejo_pasar(make_env):
    env = make_env(MIN_REVIEW_OBSERVATIONS=2)
    env.market.set("aaa")  # pasa todo y llega al director
    env.market.set("bbb", liquidity_usd=1_000)  # el escáner la filtra
    lesson = "Las ganadoras de hoy tenían poca liquidez pero volumen acelerando"
    env.llm.revision = Review(summary="bbb multiplicó x5 aunque la filtramos", lessons=[lesson])
    env.tick()
    obs = env.journal.data.observations
    assert (obs["aaa"].stage, obs["bbb"].stage, obs["bbb"].detail) == ("candidata", "filtrada", "liquidez baja")

    env.market.price("bbb", 0.05)
    env.advance(CYCLE)
    env.tick()
    assert obs["bbb"].max_multiple == approx(5)

    env.advance(24 * 3600)
    env.tick()  # terminó el período: revisión, lecciones y después el ciclo del director
    stats = json.loads(env.llm.prompts["revision"][-1])["estadisticas"]
    assert stats["grupos"]["ganadoras"]["cantidad"] == 1
    assert stats["hasta_donde_llegaron_las_ganadoras"] == {"filtrada: liquidez baja": 1}
    assert stats["ejemplos_ganadoras"][0]["simbolo"] == "BBB"
    assert env.journal.lessons == [lesson]
    assert any(n.startswith("🧠 Revisión") for n in env.notes)
    assert lesson in json.loads(env.llm.prompts["director"][-1])["lecciones_aprendidas"]


def test_sigue_observando_aunque_no_pueda_comprar(make_env):
    env = make_env(MAX_POSITIONS=1)
    env.market.set("aaa")
    env.llm.director.theses = [thesis("aaa")]
    env.tick()  # compra aaa y ocupa el único lugar
    env.market.set("bbb")
    env.advance(CYCLE)
    env.tick()
    assert env.journal.data.observations["bbb"].stage == "candidata"
    assert "BBB" not in env.llm.prompts["director"][-1]  # al director no le llegan candidatas si no puede comprar
