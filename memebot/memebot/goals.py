"""Metas y retiros.

El patrimonio es el capital en la billetera del bot más todo lo ya retirado. Cuando el
patrimonio cruza una meta, se retira WITHDRAW_PCT% de la ganancia hecha desde el último
retiro. Al llegar a TARGET_USD se vende todo, se retira todo y el bot se detiene.
"""

from __future__ import annotations

from dataclasses import dataclass

from .config import Config
from .models import State


@dataclass
class MilestoneResult:
    crossed: list[float]
    withdraw_usd: float


def wealth(state: State, equity: float) -> float:
    return equity + state.withdrawn_usd


def next_milestone(state: State, cfg: Config) -> float:
    return next((m for m in cfg.MILESTONES_USD if m not in state.milestones_hit), cfg.TARGET_USD)


def crossed_milestones(state: State, equity: float, cfg: Config) -> MilestoneResult:
    total = wealth(state, equity)
    crossed = [m for m in cfg.MILESTONES_USD if m <= total and m not in state.milestones_hit]
    if not crossed:
        return MilestoneResult([], 0.0)
    profit = max(0.0, equity - state.pending_withdrawal_usd - state.profit_base_usd)
    return MilestoneResult(crossed, round(profit * cfg.WITHDRAW_PCT / 100, 2))


def apply_milestones(state: State, equity: float, result: MilestoneResult) -> None:
    state.milestones_hit.extend(result.crossed)
    state.pending_withdrawal_usd += result.withdraw_usd
    state.profit_base_usd = equity - state.pending_withdrawal_usd
