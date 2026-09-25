"""Salidas automáticas según el plan que fijó el risk manager para cada posición."""

from __future__ import annotations

from dataclasses import dataclass

from .config import Config
from .models import PairMetrics, Position


@dataclass
class ExitDecision:
    fraction: float = 0  # 0 = mantener; 1 = vender todo
    reason: str = ""
    emergency: bool = False
    take_profit: bool = False


def exit_decision(p: Position, m: PairMetrics, cfg: Config, now: float) -> ExitDecision:
    price, plan = m.price_usd, p.plan
    pnl_pct = (price / p.entry_price - 1) * 100
    peak = max(p.peak_price, price)
    if m.liquidity_usd < p.entry_liquidity_usd * (1 - cfg.RUG_LIQ_DROP_PCT / 100):
        return ExitDecision(1, "la liquidez se desplomó", emergency=True)
    if pnl_pct <= -plan.stop_loss_pct:
        return ExitDecision(1, "stop-loss")
    if not p.took_profit and pnl_pct >= plan.take_profit_pct:
        return ExitDecision(cfg.TAKE_PROFIT_SELL_FRACTION, "toma de ganancia", take_profit=True)
    if p.took_profit and price <= peak * (1 - plan.trailing_stop_pct / 100):
        return ExitDecision(1, "stop dinámico")
    if not p.took_profit and now - p.opened_at >= plan.max_hold_minutes * 60 and pnl_pct < cfg.TIME_STOP_MIN_GAIN_PCT:
        return ExitDecision(1, "venció el plazo de la tesis")
    return ExitDecision()
