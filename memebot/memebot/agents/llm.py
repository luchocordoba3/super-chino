"""Llamadas a Claude con salida estructurada, registro de costo y tope de gasto diario."""

from __future__ import annotations

import time
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any, Protocol, TypeVar

from pydantic import BaseModel

from ..models import State
from ..util import log

T = TypeVar("T", bound=BaseModel)

# Precio en USD por millón de tokens (entrada, salida).
PRICES: dict[str, tuple[float, float]] = {
    "claude-opus-5": (5.0, 25.0),
    "claude-opus-4-8": (5.0, 25.0),
    "claude-sonnet-5": (2.0, 10.0),
    "claude-haiku-4-5": (1.0, 5.0),
}
DEFAULT_PRICE = (5.0, 25.0)

# Si el modelo declina la consulta, la API la reintenta sola con el modelo de respaldo que corresponda.
FALLBACK_BETA = "server-side-fallback-2026-07-01"
FALLBACK_MODELS = {"claude-opus-5"}


class BudgetExceeded(RuntimeError):
    pass


class AgentError(RuntimeError):
    pass


class Asker(Protocol):
    def ask(self, *, agent: str, model: str, effort: str, system: str, prompt: str, schema: type[T]) -> T: ...


class ClaudeLLM:
    def __init__(self, client: Any, state: State, daily_budget_usd: float, now: Callable[[], float] = time.time):
        self.client, self.state, self.budget, self.now = client, state, daily_budget_usd, now

    def _roll_day(self) -> None:
        today = datetime.fromtimestamp(self.now(), UTC).strftime("%Y-%m-%d")
        if self.state.llm_day != today:
            self.state.llm_day = today
            self.state.llm_spent_today_usd = 0

    def ask(self, *, agent: str, model: str, effort: str, system: str, prompt: str, schema: type[T]) -> T:
        self._roll_day()
        if self.state.llm_spent_today_usd >= self.budget:
            raise BudgetExceeded(f"se agotó el presupuesto diario de IA (US${self.budget:.2f})")
        kwargs: dict[str, Any] = {
            "model": model,
            "max_tokens": 16000,
            "system": system,
            "messages": [{"role": "user", "content": prompt}],
            "output_format": schema,
        }
        if "haiku" not in model:
            kwargs["output_config"] = {"effort": effort}
        if model in FALLBACK_MODELS:
            resp = self.client.beta.messages.parse(**kwargs, betas=[FALLBACK_BETA], fallbacks="default")
        else:
            resp = self.client.messages.parse(**kwargs)
        cost = self._charge(model, resp)
        log.info("%s (%s): US$%.4f", agent, resp.model, cost)
        if resp.stop_reason == "refusal":
            raise AgentError(f"{agent}: el modelo no respondió (refusal)")
        if resp.stop_reason == "max_tokens":
            raise AgentError(f"{agent}: respuesta cortada")
        if resp.parsed_output is None:
            raise AgentError(f"{agent}: respuesta sin el formato pedido")
        return resp.parsed_output

    def _charge(self, requested_model: str, resp: Any) -> float:
        u = resp.usage
        price_in, price_out = PRICES.get(resp.model, PRICES.get(requested_model, DEFAULT_PRICE))
        tokens_in = (
            (u.input_tokens or 0)
            + 1.25 * (getattr(u, "cache_creation_input_tokens", 0) or 0)
            + 0.1 * (getattr(u, "cache_read_input_tokens", 0) or 0)
        )
        cost = (tokens_in * price_in + (u.output_tokens or 0) * price_out) / 1e6
        self.state.llm_spent_today_usd += cost
        self.state.llm_spent_total_usd += cost
        return cost
