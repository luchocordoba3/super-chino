"""Escáner: filtro gratis (sin IA) que arma la lista corta de candidatas para el director."""

from __future__ import annotations

import math
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from .config import Config
from .learning import Journal
from .market import Market
from .models import PairMetrics
from .safety import Safety
from .util import clamp, log

if TYPE_CHECKING:
    from .agents.execution import ExecutionAgent


def _ratio(buys: int, sells: int) -> float:
    return buys / max(sells, 1)


def reject_reason(m: PairMetrics, cfg: Config, now: float) -> str | None:
    """Motivo por el que una moneda no califica, o None si pasa todos los filtros."""
    age_min = (now - m.created_at) / 60
    if m.liquidity_usd < cfg.MIN_LIQUIDITY_USD:
        return "liquidez baja"
    if m.volume_h1 < cfg.MIN_VOLUME_H1_USD:
        return "poco volumen"
    if age_min < cfg.PAIR_AGE_MIN_MINUTES:
        return "demasiado nueva"
    if age_min > cfg.PAIR_AGE_MAX_HOURS * 60:
        return "demasiado vieja"
    if not cfg.MCAP_MIN_USD <= m.market_cap_usd <= cfg.MCAP_MAX_USD:
        return "capitalización fuera de rango"
    if min(_ratio(m.buys_m5, m.sells_m5), _ratio(m.buys_h1, m.sells_h1)) < cfg.MIN_BUY_SELL_RATIO:
        return "no dominan las compras"
    if m.change_m5 <= 0:
        return "sin impulso a 5 min"
    return None


def score(m: PairMetrics, cfg: Config) -> float:
    """De 0 a 1: presión compradora, aceleración del volumen, tendencia y profundidad de liquidez."""

    def share(b: int, s: int) -> float:
        return 0.5 if b + s == 0 else b / (b + s)

    pressure = clamp((0.5 * share(m.buys_m5, m.sells_m5) + 0.5 * share(m.buys_h1, m.sells_h1) - 0.5) / 0.3, 0, 1)
    accel = clamp((m.volume_m5 * 12 / m.volume_h1 - 0.5) / 1.5, 0, 1) if m.volume_h1 > 0 else 0
    trend = 0.5 * clamp(m.change_m5 / 10, 0, 1) + 0.5 * clamp(m.change_h1 / 100, 0, 1)
    depth = clamp(math.log10(max(m.liquidity_usd, 1) / max(cfg.MIN_LIQUIDITY_USD, 1)), 0, 1)
    return 0.3 * pressure + 0.3 * accel + 0.25 * trend + 0.15 * depth


@dataclass
class Candidate:
    metrics: PairMetrics
    decimals: int
    score: float
    warnings: list[str] = field(default_factory=list)

    def describe(self, now: float) -> dict[str, Any]:
        """Datos compactos para los agentes (menos tokens = menos costo)."""
        m = self.metrics
        return {
            "mint": m.mint,
            "simbolo": m.symbol,
            "precio_usd": m.price_usd,
            "liquidez_usd": round(m.liquidity_usd),
            "capitalizacion_usd": round(m.market_cap_usd),
            "edad_horas": round((now - m.created_at) / 3600, 1),
            "volumen_usd": {"5m": round(m.volume_m5), "1h": round(m.volume_h1), "24h": round(m.volume_h24)},
            "variacion_pct": {"5m": m.change_m5, "1h": m.change_h1, "6h": m.change_h6, "24h": m.change_h24},
            "compras_ventas": {"5m": [m.buys_m5, m.sells_m5], "1h": [m.buys_h1, m.sells_h1]},
            "puntaje_escaner": self.score,
            "alertas_rugcheck": self.warnings,
        }


class Scanner:
    def __init__(
        self,
        market: Market,
        safety: Safety,
        execution: ExecutionAgent,
        cfg: Config,
        journal: Journal | None = None,
        now: Callable[[], float] = time.time,
    ):
        self.market, self.safety, self.execution, self.cfg = market, safety, execution, cfg
        self.journal, self.now = journal, now

    def _observe(self, m: PairMetrics, sc: float, stage: str, detail: str = "") -> None:
        if self.journal is not None:
            self.journal.observe(m, sc, stage, detail)

    def candidates(self, exclude: set[str]) -> list[Candidate]:
        cfg = self.cfg
        mints = [m for m in self.market.discover() if m not in exclude]
        if not mints:
            return []
        now = self.now()
        scored: list[tuple[float, PairMetrics]] = []
        for m in self.market.metrics(mints).values():
            sc = score(m, cfg)
            reason = reject_reason(m, cfg, now)
            if reason:
                self._observe(m, sc, "filtrada", reason)
            elif sc < cfg.MIN_SCORE:
                self._observe(m, sc, "puntaje bajo")
            else:
                scored.append((sc, m))
        scored.sort(key=lambda x: x[0], reverse=True)
        out: list[Candidate] = []
        for sc, m in scored:
            if len(out) >= cfg.MAX_CANDIDATES:
                self._observe(m, sc, "puntaje bajo", "no quedó entre las mejores")
                continue
            report = self.safety.check(m.mint)
            if not report.ok or report.decimals is None:
                log.info("%s: descartada (%s)", m.symbol, report.reason)
                self._observe(m, sc, "insegura", report.reason)
                continue
            if not self.execution.sellable(m.mint, m.price_usd, report.decimals):
                self._observe(m, sc, "insegura", "sin ruta de venta")
                continue
            self._observe(m, sc, "candidata")
            out.append(Candidate(m, report.decimals, round(sc, 2), report.warnings))
        log.info("escáner: %d monedas, %d candidatas para el director", len(mints), len(out))
        return out
