"""Configuración: variables de entorno o archivo .env."""

from __future__ import annotations

import os
from collections.abc import Mapping
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Effort = Literal["low", "medium", "high", "xhigh", "max"]


class Config(BaseModel):
    model_config = ConfigDict(extra="ignore")

    MODE: Literal["paper", "live"] = "paper"
    DATA_DIR: str = "data"

    # Objetivo final, metas intermedias y retiros
    TARGET_USD: float = Field(2_000_000, gt=0)
    MILESTONES_USD: list[float] = [100_000, 300_000, 600_000, 1_000_000, 1_500_000]
    WITHDRAW_PCT: float = Field(50, ge=0, le=100)
    WITHDRAW_ADDRESS: str | None = None
    BUST_USD: float = Field(10, ge=0)

    # Simulación
    PAPER_START_USD: float = Field(1000, ge=0)
    PAPER_FEE_USD: float = Field(0.05, ge=0)
    PAPER_SLIPPAGE_PCT: float = Field(1, ge=0, le=50)

    # Conexiones
    SOLANA_RPC_URL: str = "https://api.mainnet-beta.solana.com"
    WALLET_PRIVATE_KEY: str | None = None
    JUP_API_URL: str = "https://lite-api.jup.ag"
    JUP_API_KEY: str | None = None
    RUGCHECK_API_URL: str = "https://api.rugcheck.xyz"
    TELEGRAM_BOT_TOKEN: str | None = None
    TELEGRAM_CHAT_ID: str | None = None

    # Agentes de IA
    DIRECTOR_MODEL: str = "claude-opus-5"
    QUANT_MODEL: str = "claude-sonnet-5"
    RISK_MODEL: str = "claude-sonnet-5"
    DIRECTOR_EFFORT: Effort = "medium"
    QUANT_EFFORT: Effort = "medium"
    RISK_EFFORT: Effort = "medium"
    DIRECTOR_MINUTES: float = Field(15, gt=0)
    MAX_CANDIDATES: int = Field(10, ge=1)
    MAX_THESES: int = Field(3, ge=1)
    LLM_DAILY_BUDGET_USD: float = Field(20, ge=0)

    # Topes duros de riesgo: ningún agente los puede pasar
    MAX_POSITIONS: int = Field(3, ge=1)
    MAX_POSITION_PCT: float = Field(25, gt=0, le=100)
    MAX_POOL_FRACTION: float = Field(0.02, gt=0, le=1)
    MAX_PRICE_IMPACT_PCT: float = Field(2, ge=0)
    MIN_TRADE_USD: float = Field(5, ge=0)
    STOP_LOSS_MIN_PCT: float = Field(5, gt=0)
    STOP_LOSS_MAX_PCT: float = Field(40, gt=0, lt=100)
    MAX_HOLD_MINUTES: int = Field(24 * 60, ge=10)
    SLIPPAGE_BPS: int = Field(300, ge=1)
    EMERGENCY_SLIPPAGE_BPS: int = Field(1500, ge=1)
    MAX_PRIORITY_FEE_LAMPORTS: int = Field(1_000_000, ge=0)
    SOL_FEE_RESERVE: float = Field(0.05, ge=0)

    # Escáner: filtro gratis antes de gastar en IA
    MIN_LIQUIDITY_USD: float = 30_000
    MIN_VOLUME_H1_USD: float = 50_000
    PAIR_AGE_MIN_MINUTES: float = 30
    PAIR_AGE_MAX_HOURS: float = 72
    MCAP_MIN_USD: float = 100_000
    MCAP_MAX_USD: float = 20_000_000
    MIN_BUY_SELL_RATIO: float = 1.2
    MIN_SCORE: float = 0.5

    # Salidas
    TAKE_PROFIT_SELL_FRACTION: float = Field(0.5, gt=0, le=1)
    TIME_STOP_MIN_GAIN_PCT: float = 10
    RUG_LIQ_DROP_PCT: float = Field(50, gt=0, le=100)

    # Pausas y ritmo
    LOSS_STREAK_PAUSE: int = Field(4, ge=1)
    PAUSE_MINUTES: float = Field(60, ge=0)
    REENTRY_COOLDOWN_HOURS: float = Field(6, ge=0)
    TICK_SECONDS: float = Field(15, gt=0)

    @field_validator("MILESTONES_USD", mode="before")
    @classmethod
    def _split_milestones(cls, v: object) -> object:
        if isinstance(v, str):
            return [float(x) for x in v.replace(" ", "").split(",") if x]
        return v

    @model_validator(mode="after")
    def _check(self) -> Config:
        m = self.MILESTONES_USD
        if m != sorted(m) or len(set(m)) != len(m) or (m and m[-1] >= self.TARGET_USD):
            raise ValueError("MILESTONES_USD tiene que ir de menor a mayor, sin repetir y por debajo de TARGET_USD")
        if self.STOP_LOSS_MIN_PCT > self.STOP_LOSS_MAX_PCT:
            raise ValueError("STOP_LOSS_MIN_PCT no puede ser mayor que STOP_LOSS_MAX_PCT")
        return self


def parse_config(env: Mapping[str, str]) -> Config:
    """Las variables vacías (`CLAVE=`) cuentan como no definidas."""
    known = Config.model_fields
    return Config.model_validate({k: v for k, v in env.items() if k in known and v.strip() != ""})


def load_dotenv(path: str = ".env") -> None:
    """Carga `CLAVE=valor` desde un .env sin pisar las variables ya definidas."""
    p = Path(path)
    if not p.exists():
        return
    for line in p.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def load_config() -> Config:
    load_dotenv()
    return parse_config(os.environ)
