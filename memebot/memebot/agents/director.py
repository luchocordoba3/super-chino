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

Te llegan:
- "candidatas": monedas que ya pasaron filtros de liquidez, volumen y controles anti-estafa, con sus métricas.
- "cartera": capital, efectivo libre, posiciones abiertas con su tesis, últimas operaciones y avance hacia las metas.

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


class Director:
    def __init__(self, llm: Asker, cfg: Config):
        self.llm, self.cfg = llm, cfg
        self.system = SYSTEM.format(
            target=fmt_usd(cfg.TARGET_USD),
            milestones=", ".join(fmt_usd(m) for m in cfg.MILESTONES_USD) or "ninguna",
            max_theses=cfg.MAX_THESES,
        )

    def run(self, candidates: list[Candidate], portfolio: dict[str, Any], now: float) -> DirectorReport:
        prompt = json.dumps(
            {"candidatas": [c.describe(now) for c in candidates], "cartera": portfolio}, ensure_ascii=False
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
