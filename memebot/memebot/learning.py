"""Aprendizaje.

El bot sigue todas las monedas que ve el escáner, las compre o no, y mide cuánto multiplicaron
en las horas siguientes. Una vez por día el director compara las que multiplicaron con las que
se desplomaron y escribe lecciones. El director y el quant las leen en cada ciclo.
"""

from __future__ import annotations

import os
import statistics
import time
from collections import Counter
from collections.abc import Callable
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from .config import Config
from .models import PairMetrics, Position

# Etapas del embudo, de menor a mayor avance.
STAGES = ["filtrada", "puntaje bajo", "insegura", "candidata", "tesis", "aprobada por el quant", "comprada"]
COLLAPSE_MULTIPLE = 0.3


class Observation(BaseModel):
    metrics: PairMetrics  # foto de la primera vez que el bot la vio
    score: float
    seen_at: float
    stage: str
    detail: str = ""
    max_multiple: float = 1.0
    last_multiple: float = 1.0
    final_multiple: float | None = None  # al terminar el período de observación


class ClosedTrade(BaseModel):
    at: float
    symbol: str
    thesis: str
    pnl_pct: float
    peak_multiple: float
    minutes_held: int
    exit_reason: str


class JournalData(BaseModel):
    observations: dict[str, Observation] = {}
    closed: list[ClosedTrade] = []
    lessons: list[str] = []
    last_review_at: float = 0
    last_review_summary: str = ""


def _share(buys: int, sells: int) -> float:
    return 0.5 if buys + sells == 0 else buys / (buys + sells)


def _profile(group: list[Observation]) -> dict[str, Any]:
    """Mediana de cada métrica en el momento en que el bot vio la moneda."""
    if not group:
        return {"cantidad": 0}

    def med(f: Callable[[Observation], float]) -> float:
        return round(statistics.median(f(o) for o in group), 2)

    return {
        "cantidad": len(group),
        "edad_horas": med(lambda o: (o.seen_at - o.metrics.created_at) / 3600),
        "liquidez_usd": med(lambda o: o.metrics.liquidity_usd),
        "capitalizacion_usd": med(lambda o: o.metrics.market_cap_usd),
        "aceleracion_volumen": med(
            lambda o: o.metrics.volume_m5 * 12 / o.metrics.volume_h1 if o.metrics.volume_h1 else 0
        ),
        "compras_sobre_total_5m": med(lambda o: _share(o.metrics.buys_m5, o.metrics.sells_m5)),
        "compras_sobre_total_1h": med(lambda o: _share(o.metrics.buys_h1, o.metrics.sells_h1)),
        "variacion_5m_pct": med(lambda o: o.metrics.change_m5),
        "variacion_1h_pct": med(lambda o: o.metrics.change_h1),
        "variacion_24h_pct": med(lambda o: o.metrics.change_h24),
        "puntaje_escaner": med(lambda o: o.score),
    }


def _example(o: Observation) -> dict[str, Any]:
    m = o.metrics
    return {
        "simbolo": m.symbol,
        "maximo_multiplo": round(o.max_multiple, 2),
        "multiplo_final": round(o.final_multiple or 0, 2),
        "etapa": o.stage + (f" ({o.detail})" if o.detail else ""),
        "al_verla": {
            "edad_horas": round((o.seen_at - m.created_at) / 3600, 1),
            "liquidez_usd": round(m.liquidity_usd),
            "capitalizacion_usd": round(m.market_cap_usd),
            "volumen_usd": {"5m": round(m.volume_m5), "1h": round(m.volume_h1)},
            "variacion_pct": {"5m": m.change_m5, "1h": m.change_h1, "24h": m.change_h24},
            "compras_ventas": {"5m": [m.buys_m5, m.sells_m5], "1h": [m.buys_h1, m.sells_h1]},
            "puntaje_escaner": o.score,
        },
    }


class Journal:
    """Diario de aprendizaje en data/learning.json. Se comparte entre simulación y real."""

    def __init__(self, path: str | Path, now: Callable[[], float] = time.time):
        self.path, self.now = Path(path), now
        self.data = JournalData.model_validate_json(self.path.read_text()) if self.path.exists() else JournalData()
        if not self.data.last_review_at:
            self.data.last_review_at = now()  # la primera revisión es un período después de arrancar
        self.dirty = True

    @property
    def lessons(self) -> list[str]:
        return self.data.lessons

    def observe(self, m: PairMetrics, score: float, stage: str, detail: str = "") -> None:
        """Registra la moneda la primera vez que aparece; después solo actualiza hasta dónde llegó."""
        if m.mint in self.data.observations:
            self.mark(m.mint, stage, detail)
            return
        self.data.observations[m.mint] = Observation(
            metrics=m, score=round(score, 2), seen_at=self.now(), stage=stage, detail=detail
        )
        self.dirty = True

    def mark(self, mint: str, stage: str, detail: str = "") -> None:
        obs = self.data.observations.get(mint)
        if obs is not None and STAGES.index(stage) > STAGES.index(obs.stage):
            obs.stage, obs.detail = stage, detail
            self.dirty = True

    def pending(self) -> list[str]:
        return [mint for mint, o in self.data.observations.items() if o.final_multiple is None]

    def track(self, prices: dict[str, float], cfg: Config) -> None:
        """Actualiza cuánto multiplicó cada moneda desde que el bot la vio y cierra las que cumplieron el período."""
        now = self.now()
        for mint, obs in self.data.observations.items():
            if obs.final_multiple is not None:
                continue
            price = prices.get(mint)
            if price is not None and obs.metrics.price_usd > 0:
                obs.last_multiple = price / obs.metrics.price_usd
                obs.max_multiple = max(obs.max_multiple, obs.last_multiple)
            if now - obs.seen_at >= cfg.OBSERVE_HOURS * 3600:
                obs.final_multiple = obs.last_multiple
        self.dirty = True

    def record_close(self, p: Position, reason: str) -> None:
        now = self.now()
        self.data.closed.append(
            ClosedTrade(
                at=now,
                symbol=p.symbol,
                thesis=p.thesis[:300],
                pnl_pct=round(p.realized_pnl_usd / p.invested_usd * 100, 1) if p.invested_usd else 0,
                peak_multiple=round(p.peak_price / p.entry_price, 2),
                minutes_held=int((now - p.opened_at) / 60),
                exit_reason=reason,
            )
        )
        self.data.closed = self.data.closed[-100:]
        self.dirty = True

    def recent_trades(self, n: int = 10) -> list[dict[str, Any]]:
        return [
            {
                "simbolo": t.symbol,
                "resultado_pct": t.pnl_pct,
                "maximo_multiplo": t.peak_multiple,
                "salida": t.exit_reason,
            }
            for t in self.data.closed[-n:]
        ]

    def finished(self) -> list[Observation]:
        return [o for o in self.data.observations.values() if o.final_multiple is not None]

    def review_due(self, cfg: Config) -> bool:
        waited = self.now() - self.data.last_review_at >= cfg.REVIEW_HOURS * 3600
        return waited and len(self.finished()) >= cfg.MIN_REVIEW_OBSERVATIONS

    def stats(self, cfg: Config) -> dict[str, Any]:
        """Estadísticas para la revisión diaria, calculadas sin IA."""
        done = self.finished()
        winners = sorted((o for o in done if o.max_multiple >= cfg.WINNER_MULTIPLE), key=lambda o: -o.max_multiple)
        collapsed = sorted(
            (o for o in done if (o.final_multiple or 0) <= COLLAPSE_MULTIPLE and o.max_multiple < cfg.WINNER_MULTIPLE),
            key=lambda o: o.final_multiple or 0,
        )
        grouped = {id(o) for o in winners} | {id(o) for o in collapsed}
        rest = [o for o in done if id(o) not in grouped]
        missed = Counter(f"{o.stage}: {o.detail}" if o.detail else o.stage for o in winners)
        since = self.data.last_review_at
        return {
            "monedas_observadas": len(done),
            "criterio_ganadora": f"multiplicó x{cfg.WINNER_MULTIPLE:g} o más dentro de las {cfg.OBSERVE_HOURS:g} h "
            "siguientes a que el bot la vio",
            "criterio_desplome": f"al final del período valía {COLLAPSE_MULTIPLE:.0%} o menos de su precio inicial",
            "grupos": {"ganadoras": _profile(winners), "desplomadas": _profile(collapsed), "resto": _profile(rest)},
            "hasta_donde_llegaron_las_ganadoras": dict(missed.most_common()),
            "ejemplos_ganadoras": [_example(o) for o in winners[:8]],
            "ejemplos_desplomadas": [_example(o) for o in collapsed[:5]],
            "operaciones_del_bot": [t.model_dump(exclude={"at"}) for t in self.data.closed if t.at >= since],
        }

    def apply_review(self, lessons: list[str], summary: str, cfg: Config) -> None:
        self.data.lessons = [x.strip()[:300] for x in lessons if x.strip()][: cfg.MAX_LESSONS]
        self.data.last_review_summary = summary.strip()[:600]
        self.data.last_review_at = self.now()
        # Lo que ya se revisó se descarta: el aprendizaje queda en las lecciones.
        self.data.observations = {k: o for k, o in self.data.observations.items() if o.final_multiple is None}
        self.dirty = True

    def save(self) -> None:
        if not self.dirty:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".json.tmp")
        tmp.write_text(self.data.model_dump_json())
        os.replace(tmp, self.path)
        self.dirty = False
