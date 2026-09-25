"""Risk manager: decide el tamaño y el plan de salida. Los topes duros se aplican en código."""

from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel, Field

from ..config import Config
from ..scanner import Candidate
from ..util import clamp
from .director import Thesis
from .llm import Asker
from .quant import QuantVerdict

TAKE_PROFIT_RANGE = (5.0, 1000.0)
TRAILING_STOP_RANGE = (5.0, 50.0)
MIN_HOLD_MINUTES = 10


class RiskDecision(BaseModel):
    approve: bool
    size_pct: float = Field(description="Porcentaje del capital a invertir")
    stop_loss_pct: float
    take_profit_pct: float
    trailing_stop_pct: float
    max_hold_minutes: int
    rationale: str


SYSTEM = """Sos el risk manager de un bot que opera memecoins en Solana. Para cada tesis aprobada por el quant \
decidís cuánto arriesgar y el plan de salida.

Topes que se aplican siempre (si los pasás, se recortan):
- tamaño: hasta {max_pos}% del capital por operación;
- stop-loss: entre {sl_min}% y {sl_max}%;
- toma de ganancia: entre {tp_min}% y {tp_max}% (al alcanzarla se vende el {tp_sell}% de la posición);
- stop dinámico después de la toma de ganancia: entre {tr_min}% y {tr_max}% desde el máximo;
- plazo máximo: entre {hold_min} y {hold_max} minutos.

Tené en cuenta la convicción del director, la confianza del quant, cuánto capital ya está invertido, la racha \
de pérdidas y el avance hacia las metas. Si el riesgo no se justifica, no apruebes. Nunca propongas más que el \
efectivo libre."""


def enforce_limits(d: RiskDecision, cfg: Config) -> RiskDecision:
    """Recorta la decisión a los topes duros de la configuración."""
    return d.model_copy(
        update={
            "size_pct": clamp(d.size_pct, 0, cfg.MAX_POSITION_PCT),
            "stop_loss_pct": clamp(d.stop_loss_pct, cfg.STOP_LOSS_MIN_PCT, cfg.STOP_LOSS_MAX_PCT),
            "take_profit_pct": clamp(d.take_profit_pct, *TAKE_PROFIT_RANGE),
            "trailing_stop_pct": clamp(d.trailing_stop_pct, *TRAILING_STOP_RANGE),
            "max_hold_minutes": int(clamp(d.max_hold_minutes, MIN_HOLD_MINUTES, cfg.MAX_HOLD_MINUTES)),
        }
    )


class RiskManager:
    def __init__(self, llm: Asker, cfg: Config):
        self.llm, self.cfg = llm, cfg
        self.system = SYSTEM.format(
            max_pos=cfg.MAX_POSITION_PCT,
            sl_min=cfg.STOP_LOSS_MIN_PCT,
            sl_max=cfg.STOP_LOSS_MAX_PCT,
            tp_min=TAKE_PROFIT_RANGE[0],
            tp_max=TAKE_PROFIT_RANGE[1],
            tp_sell=round(cfg.TAKE_PROFIT_SELL_FRACTION * 100),
            tr_min=TRAILING_STOP_RANGE[0],
            tr_max=TRAILING_STOP_RANGE[1],
            hold_min=MIN_HOLD_MINUTES,
            hold_max=cfg.MAX_HOLD_MINUTES,
        )

    def run(
        self, thesis: Thesis, verdict: QuantVerdict, candidate: Candidate, portfolio: dict[str, Any], now: float
    ) -> RiskDecision:
        prompt = json.dumps(
            {
                "tesis": thesis.model_dump(),
                "veredicto_quant": verdict.model_dump(),
                "datos": candidate.describe(now),
                "cartera": portfolio,
            },
            ensure_ascii=False,
        )
        decision = self.llm.ask(
            agent="risk",
            model=self.cfg.RISK_MODEL,
            effort=self.cfg.RISK_EFFORT,
            system=self.system,
            prompt=prompt,
            schema=RiskDecision,
        )
        return enforce_limits(decision, self.cfg)
