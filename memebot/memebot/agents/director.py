"""Director: genera tesis de inversión y detecta posiciones cuya tesis se invalidó."""

from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel, Field

from ..config import Config
from ..scanner import Candidate
from ..util import fmt_usd, log
from .llm import Asker


class Thesis(BaseModel):
    mint: str = Field(description="Mint exacto, copiado de la lista de candidatas")
    symbol: str
    thesis: str = Field(description="Por qué debería subir ahora, con datos concretos")
    invalidation: str = Field(description="Qué haría falsa la tesis")
    conviction: float = Field(description="Convicción de 0 a 1")
    horizon_minutes: int = Field(description="En cuántos minutos debería cumplirse")


class CloseSignal(BaseModel):
    mint: str
    reason: str


class DirectorReport(BaseModel):
    market_view: str = Field(description="Lectura breve del mercado, una o dos oraciones")
    theses: list[Thesis]
    close_positions: list[CloseSignal]


SYSTEM = """Sos el director de inversiones de un bot que opera memecoins en Solana. Proponés tesis de inversión \
de corto plazo (de minutos a pocas horas) y detectás cuándo una posición abierta perdió su tesis.

Objetivo del fondo: llevar el patrimonio a {target}. Metas intermedias: {milestones}; en cada una se retira \
parte de la ganancia a una billetera segura.

Buscamos monedas que puedan multiplicar varias veces. La estrategia es de muchas apuestas chicas: la mayoría \
pierde poco por el stop-loss y unas pocas ganadoras pagan todo. Al duplicar se vende la mitad y el resto queda \
corriendo, así que importa más encontrar una moneda que multiplique que acertar muchas veces.

Te llegan:
- "candidatas": monedas que ya pasaron filtros de liquidez, volumen y controles anti-estafa, con sus métricas.
- "cartera": capital, efectivo libre, posiciones abiertas con su tesis, últimas operaciones y avance hacia las metas.
- "lecciones_aprendidas": lo que el bot aprendió midiendo qué pasó con todas las monedas que vio. Usalas.

Reglas:
- Solo podés proponer monedas de "candidatas", copiando el mint exacto.
- Como máximo {max_theses} tesis. Si ninguna candidata tiene una ventaja clara, devolvé la lista vacía: \
no operar es una decisión válida.
- Cada tesis explica con datos concretos por qué la moneda debería subir ahora, qué la invalidaría, \
la convicción (0 a 1) y el horizonte en minutos.
- Desconfiá de las subas verticales sin volumen que las acompañe, de las ventas dominando y de la liquidez \
baja en relación con la capitalización.
- En "close_positions" pedí cerrar solo las posiciones cuya tesis se invalidó; el ruido normal no alcanza.
- No decidís montos ni ejecutás: el quant valida, el risk manager decide el tamaño y la ejecución es automática."""


class Review(BaseModel):
    summary: str = Field(description="Qué pasó en el período, en dos o tres oraciones")
    lessons: list[str] = Field(description="Lecciones vigentes, concretas y con números. Reemplazan a las anteriores")


REVIEW_SYSTEM = """Sos el director de inversiones de un bot que opera memecoins en Solana. Cada tanto revisás qué \
pasó para que el bot aprenda a encontrar monedas que multipliquen.

Te llegan estadísticas de todas las monedas que vio el escáner en el período, las que compró y las que no: cuánto \
multiplicaron después, cómo eran las ganadoras y las que se desplomaron en el momento en que el bot las vio, hasta \
qué etapa llegaron las ganadoras (si el bot las filtró, las descartó o las compró) y las operaciones del bot.

Escribí como máximo {max_lessons} lecciones concretas, con números ("las ganadoras tenían X; las desplomadas, Y"), \
que sirvan para elegir la próxima tesis. Mantené las lecciones vigentes que los datos siguen confirmando, corregí \
las que contradicen y descartá las que no aportan. Si los datos no alcanzan para concluir algo, decilo en el \
resumen en vez de inventar un patrón."""


class Director:
    def __init__(self, llm: Asker, cfg: Config):
        self.llm, self.cfg = llm, cfg
        self.review_system = REVIEW_SYSTEM.format(max_lessons=cfg.MAX_LESSONS)
        self.system = SYSTEM.format(
            target=fmt_usd(cfg.TARGET_USD),
            milestones=", ".join(fmt_usd(m) for m in cfg.MILESTONES_USD) or "ninguna",
            max_theses=cfg.MAX_THESES,
        )

    def run(
        self, candidates: list[Candidate], portfolio: dict[str, Any], now: float, lessons: list[str]
    ) -> DirectorReport:
        prompt = json.dumps(
            {
                "candidatas": [c.describe(now) for c in candidates],
                "cartera": portfolio,
                "lecciones_aprendidas": lessons,
            },
            ensure_ascii=False,
        )
        report = self.llm.ask(
            agent="director",
            model=self.cfg.DIRECTOR_MODEL,
            effort=self.cfg.DIRECTOR_EFFORT,
            system=self.system,
            prompt=prompt,
            schema=DirectorReport,
        )
        # Nunca se opera una moneda que no vino del escáner: un mint inventado se descarta.
        allowed = {c.metrics.mint for c in candidates}
        valid = [t for t in report.theses if t.mint in allowed]
        for t in report.theses:
            if t.mint not in allowed:
                log.warning("director propuso un mint que no está entre las candidatas: %s", t.mint)
        report.theses = sorted(valid, key=lambda t: t.conviction, reverse=True)[: self.cfg.MAX_THESES]
        held = {p["mint"] for p in portfolio.get("posiciones", [])}
        report.close_positions = [c for c in report.close_positions if c.mint in held]
        return report

    def review(self, stats: dict[str, Any], lessons: list[str]) -> Review:
        """Revisión periódica: compara ganadoras y desplomadas y reescribe las lecciones."""
        prompt = json.dumps({"estadisticas": stats, "lecciones_vigentes": lessons}, ensure_ascii=False)
        return self.llm.ask(
            agent="revision",
            model=self.cfg.DIRECTOR_MODEL,
            effort=self.cfg.DIRECTOR_EFFORT,
            system=self.review_system,
            prompt=prompt,
            schema=Review,
        )
