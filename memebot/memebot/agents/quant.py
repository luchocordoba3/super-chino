"""Quant: valida cada tesis del director contra los datos."""

from __future__ import annotations

import json

from pydantic import BaseModel, Field

from ..config import Config
from ..scanner import Candidate
from .director import Thesis
from .llm import Asker


class QuantVerdict(BaseModel):
    approved: bool
    confidence: float = Field(description="Confianza de 0 a 1 en que la tesis se cumple")
    reasoning: str = Field(description="Razonamiento breve, con los números que lo sostienen")
    red_flags: list[str]


SYSTEM = """Sos el quant de un bot que opera memecoins en Solana. Validás las tesis del director contra los \
datos antes de que se arriesgue plata.

Te llega una tesis y las métricas de la moneda. Aprobá solo si los números sostienen la tesis: volumen que \
acompaña la suba, compras dominando en 5 minutos y en 1 hora, liquidez suficiente para entrar y salir, y \
ninguna alerta grave. Si la tesis se apoya en algo que los datos no muestran, rechazala.

Sé exigente: en memecoins la mayoría de las tesis fallan. Explicá tu razonamiento en pocas oraciones y listá \
las señales de alerta. Tené en cuenta las lecciones aprendidas: salen de medir qué pasó con todas las \
monedas que vio el bot."""


class Quant:
    def __init__(self, llm: Asker, cfg: Config):
        self.llm, self.cfg = llm, cfg

    def run(self, thesis: Thesis, candidate: Candidate, now: float, lessons: list[str]) -> QuantVerdict:
        prompt = json.dumps(
            {"tesis": thesis.model_dump(), "datos": candidate.describe(now), "lecciones_aprendidas": lessons},
            ensure_ascii=False,
        )
        return self.llm.ask(
            agent="quant",
            model=self.cfg.QUANT_MODEL,
            effort=self.cfg.QUANT_EFFORT,
            system=SYSTEM,
            prompt=prompt,
            schema=QuantVerdict,
        )
