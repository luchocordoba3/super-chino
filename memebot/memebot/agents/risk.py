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

MIN_HOLD_MINUTES = 10


class RiskDecision(BaseModel):
    approve: bool
    size_pct: float = Field(description="Porcentaje del capital a invertir")
    stop_loss_pct: float = Field(description="Stop-loss antes de duplicar")
    trailing_stop_pct: float = Field(description="Stop dinámico de lo que queda corriendo, desde el máximo")
    max_hold_minutes: int = Field(description="Plazo para que la tesis despegue")
    rationale: str


SYSTEM = """Sos el risk manager de un bot que opera memecoins en Solana con una estrategia de muchas apuestas \
chicas: la mayoría pierde poco por el stop-loss y unas pocas ganadoras pagan todo. Para cada tesis aprobada por \
el quant decidís el tamaño y cómo salir.

Una parte del plan de salida es fija: cuando la moneda sube +{tp}%, se vende el {tp_sell}% de la posición \
(se recupera lo invertido) y el resto queda corriendo. Vos elegís:
- tamaño: hasta {max_pos}% del capital;
- stop-loss antes de llegar a +{tp}%: entre {sl_min}% y {sl_max}%;
- stop dinámico de lo que queda corriendo: entre {tr_min}% y {tr_max}% desde el máximo (más amplio deja \
correr más a una ganadora, pero devuelve más ganancia si se da vuelta);
- plazo: entre {hold_min} y {hold_max} minutos; si en ese plazo no sube al menos {min_gain}%, se vende.
Si pasás un tope, se recorta.

Tené en cuenta la convicción del director, la confianza del quant, cuánto capital ya está invertido, la racha \
de pérdidas y el avance hacia las metas. Si el riesgo no se justifica, no apruebes."""


def enforce_limits(d: RiskDecision, cfg: Config) -> RiskDecision:
    """Recorta la decisión a los topes duros de la configuración."""
    return d.model_copy(
        update={
            "size_pct": clamp(d.size_pct, 0, cfg.MAX_POSITION_PCT),
            "stop_loss_pct": clamp(d.stop_loss_pct, cfg.STOP_LOSS_MIN_PCT, cfg.STOP_LOSS_MAX_PCT),
            "trailing_stop_pct": clamp(d.trailing_stop_pct, cfg.TRAILING_STOP_MIN_PCT, cfg.TRAILING_STOP_MAX_PCT),
            "max_hold_minutes": int(clamp(d.max_hold_minutes, MIN_HOLD_MINUTES, cfg.MAX_HOLD_MINUTES)),
        }
    )


class RiskManager:
    def __init__(self, llm: Asker, cfg: Config):
        self.llm, self.cfg = llm, cfg
        self.system = SYSTEM.format(
            tp=f"{cfg.TAKE_PROFIT_PCT:g}",
            tp_sell=round(cfg.TAKE_PROFIT_SELL_FRACTION * 100),
            max_pos=f"{cfg.MAX_POSITION_PCT:g}",
            sl_min=f"{cfg.STOP_LOSS_MIN_PCT:g}",
            sl_max=f"{cfg.STOP_LOSS_MAX_PCT:g}",
            tr_min=f"{cfg.TRAILING_STOP_MIN_PCT:g}",
            tr_max=f"{cfg.TRAILING_STOP_MAX_PCT:g}",
            hold_min=MIN_HOLD_MINUTES,
            hold_max=cfg.MAX_HOLD_MINUTES,
            min_gain=f"{cfg.TIME_STOP_MIN_GAIN_PCT:g}",
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
