"""Datos del mercado y estado persistente del bot."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class PairMetrics(BaseModel):
    """Métricas de una moneda, tomadas de su par contra SOL o USDC con más liquidez."""

    mint: str
    symbol: str
    price_usd: float
    liquidity_usd: float
    market_cap_usd: float
    volume_m5: float = 0
    volume_h1: float = 0
    volume_h24: float = 0
    change_m5: float = 0
    change_h1: float = 0
    change_h6: float = 0
    change_h24: float = 0
    buys_m5: int = 0
    sells_m5: int = 0
    buys_h1: int = 0
    sells_h1: int = 0
    created_at: float  # segundos (epoch)


class ExitPlan(BaseModel):
    """Plan de salida que decide el risk manager (ya recortado a los topes)."""

    stop_loss_pct: float
    take_profit_pct: float
    trailing_stop_pct: float
    max_hold_minutes: int


class Position(BaseModel):
    mint: str
    symbol: str
    decimals: int
    amount_raw: int
    cost_usd: float  # costo de la parte que todavía se tiene
    invested_usd: float  # lo que se invirtió al entrar
    entry_price: float  # USD por moneda, con comisiones
    entry_liquidity_usd: float
    peak_price: float
    opened_at: float
    plan: ExitPlan
    thesis: str = ""
    took_profit: bool = False
    realized_pnl_usd: float = 0

    @property
    def units(self) -> float:
        return self.amount_raw / 10**self.decimals


class Trade(BaseModel):
    at: float
    side: Literal["buy", "sell", "withdraw"]
    mint: str
    symbol: str
    usd: float
    amount_raw: int
    reason: str
    pnl_usd: float | None = None
    signature: str | None = None


class State(BaseModel):
    version: int = 2
    mode: Literal["paper", "live"]
    status: Literal["running", "won", "busted"] = "running"
    started_at: float
    ended_at: float | None = None
    cash_usd: float  # USDC en la billetera del bot
    positions: list[Position] = []
    loss_streak: int = 0
    paused_until: float = 0
    cooldowns: dict[str, float] = {}
    last_equity_usd: float
    peak_equity_usd: float
    trades: int = 0
    # Metas y retiros
    milestones_hit: list[float] = []
    withdrawn_usd: float = 0
    pending_withdrawal_usd: float = 0
    profit_base_usd: float  # capital justo después del último retiro (o al empezar)
    # Gasto en IA
    llm_day: str = ""
    llm_spent_today_usd: float = 0
    llm_spent_total_usd: float = 0

    @classmethod
    def fresh(cls, mode: Literal["paper", "live"], cash_usd: float, now: float) -> State:
        return cls(
            mode=mode,
            started_at=now,
            cash_usd=cash_usd,
            last_equity_usd=cash_usd,
            peak_equity_usd=cash_usd,
            profit_base_usd=cash_usd,
        )
