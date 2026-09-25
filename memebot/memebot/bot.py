"""Orquestación: escáner → director → quant → risk manager → ejecución, más metas, retiros y salidas."""

from __future__ import annotations

import math
import threading
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from .agents.director import Director, Thesis
from .agents.execution import ExecutionAgent
from .agents.llm import AgentError, BudgetExceeded
from .agents.quant import Quant
from .agents.risk import RiskDecision, RiskManager
from .chain import raw_to_usd, usd_to_raw
from .config import Config
from .exits import exit_decision
from .goals import apply_milestones, crossed_milestones, next_milestone, wealth
from .market import USDC_MINT
from .models import ExitPlan, PairMetrics, Position, State, Trade
from .scanner import Candidate, Scanner
from .state import Store
from .util import fmt_usd, log, signed_usd

DAY = 24 * 3600


@dataclass
class Agents:
    director: Director
    quant: Quant
    risk: RiskManager
    execution: ExecutionAgent


class Bot:
    def __init__(
        self,
        *,
        cfg: Config,
        state: State,
        store: Store,
        scanner: Scanner,
        agents: Agents,
        notify: Callable[[str], None],
        now: Callable[[], float] = time.time,
    ):
        self.cfg, self.state, self.store, self.scanner, self.notify, self.now = cfg, state, store, scanner, notify, now
        self.director, self.quant, self.risk, self.execution = agents.director, agents.quant, agents.risk, agents.execution
        self.broker = agents.execution.broker
        self.last_cycle = -math.inf
        self.last_error = -math.inf
        self.last_fee_warning = -math.inf
        self.budget_warned_day = ""
        self.last_summary = now()
        self.recent: deque[dict[str, Any]] = deque(maxlen=10)

    def run(self, stop: threading.Event) -> None:
        mode = "REAL" if self.cfg.MODE == "live" else "simulación"
        self.notify(
            f"Arranca en modo {mode}. Patrimonio {fmt_usd(wealth(self.state, self.state.last_equity_usd))}, "
            f"objetivo {fmt_usd(self.cfg.TARGET_USD)}."
        )
        while not stop.is_set():
            if not self.tick():
                return
            stop.wait(self.cfg.TICK_SECONDS)
        log.info("Detenido. Las posiciones abiertas se retoman al volver a arrancar.")

    def tick(self) -> bool:
        """Un ciclo. Devuelve False cuando el bot terminó (ganó o quebró)."""
        s = self.state
        if s.status != "running":
            return False
        try:
            held = self._held_metrics()
            cash = self.broker.cash_usd()
            s.cash_usd = cash
            equity = cash + sum(self._value(p, held.get(p.mint)) for p in s.positions)
            s.last_equity_usd = equity
            s.peak_equity_usd = max(s.peak_equity_usd, equity)
            if not (self._check_final(equity, cash) or self._check_bust(equity, cash)):
                self._check_milestones(equity)
                self._process_withdrawals()
                if self.store.panic():
                    self._liquidate("botón de pánico", emergency=False)
                else:
                    self._manage_exits(held)
                    if self.now() - self.last_cycle >= self.cfg.DIRECTOR_MINUTES * 60:
                        self.last_cycle = self.now()
                        self._investment_cycle(equity, held)
                self._maybe_summary()
        except Exception as e:
            self._report_error(e)
        finally:
            self.store.save(s)
        return s.status == "running"

    # ---- fin del juego -------------------------------------------------------------------------

    def _check_final(self, equity: float, cash: float) -> bool:
        s, cfg = self.state, self.cfg
        if wealth(s, equity) < cfg.TARGET_USD:
            return False
        # Se confirma con cotizaciones reales de venta antes de declarar la victoria.
        if self._realizable(cash) + s.withdrawn_usd < cfg.TARGET_USD:
            return False
        self._liquidate("objetivo final cumplido", emergency=False)
        if s.positions:
            return False  # alguna venta falló: se reintenta en el próximo ciclo
        remaining = self.broker.cash_usd()
        try:
            if remaining >= 1:
                self._withdraw(remaining, "retiro final")
        except Exception as e:
            self._report_error(RuntimeError(f"falló el retiro final ({e}): retirá los fondos a mano"))
        s.pending_withdrawal_usd = 0
        self._finish("won")
        total = s.withdrawn_usd + self.broker.cash_usd()
        self.notify(f"🏆 OBJETIVO FINAL CUMPLIDO: patrimonio {fmt_usd(total)}. El bot no vuelve a operar.")
        return True

    def _check_bust(self, equity: float, cash: float) -> bool:
        s, cfg = self.state, self.cfg
        # Una billetera que nunca tuvo capital (por ejemplo, todavía sin USDC) no "quiebra".
        if s.peak_equity_usd < max(cfg.BUST_USD, cfg.MIN_TRADE_USD):
            return False
        free = cash - s.pending_withdrawal_usd
        cannot_trade = not s.positions and free < cfg.MIN_TRADE_USD + self.broker.swap_fee_usd
        if not cannot_trade and (equity >= cfg.BUST_USD or self._realizable(cash) >= cfg.BUST_USD):
            return False
        self._liquidate("quiebra", emergency=True)
        self._finish("busted")
        self.notify(
            f"💀 Capital de trading agotado ({fmt_usd(self.broker.cash_usd())}). Lo retirado "
            f"({fmt_usd(s.withdrawn_usd)}) está a salvo en tu billetera. El bot se apaga para siempre."
        )
        return True

    def _finish(self, status: str) -> None:
        self.state.status = status  # type: ignore[assignment]
        self.state.ended_at = self.now()

    # ---- metas y retiros -----------------------------------------------------------------------

    def _check_milestones(self, equity: float) -> None:
        result = crossed_milestones(self.state, equity, self.cfg)
        if not result.crossed:
            return
        apply_milestones(self.state, equity, result)
        hit = ", ".join(fmt_usd(m) for m in result.crossed)
        self.notify(
            f"🎯 Meta alcanzada: {hit}. Patrimonio {fmt_usd(wealth(self.state, equity))}. "
            f"Se retiran {fmt_usd(result.withdraw_usd)} de ganancia."
        )

    def _process_withdrawals(self) -> None:
        s = self.state
        if s.pending_withdrawal_usd < 1:
            return
        amount = round(min(s.pending_withdrawal_usd, self.broker.cash_usd()), 2)
        if amount < 1:
            return  # el efectivo está invertido: se retira cuando se cierren posiciones
        self._withdraw(amount, "meta alcanzada")
        s.pending_withdrawal_usd = max(0.0, s.pending_withdrawal_usd - amount)

    def _withdraw(self, usd: float, reason: str) -> None:
        signature = self.execution.withdraw(usd)
        s = self.state
        s.withdrawn_usd += usd
        s.cash_usd = self.broker.cash_usd()
        self._record("withdraw", USDC_MINT, "USDC", usd, usd_to_raw(usd), reason, signature=signature)
        self.notify(f"🏦 Retiro de {fmt_usd(usd)} a tu billetera ({reason}). Total retirado: {fmt_usd(s.withdrawn_usd)}.")

    # ---- posiciones ----------------------------------------------------------------------------

    def _held_metrics(self) -> dict[str, PairMetrics]:
        if not self.state.positions:
            return {}
        try:
            return self.scanner.market.metrics([p.mint for p in self.state.positions])
        except Exception as e:
            log.warning("no se pudieron leer los precios de las posiciones: %s", e)
            return {}

    @staticmethod
    def _value(p: Position, m: PairMetrics | None) -> float:
        return p.units * m.price_usd if m else p.cost_usd

    def _realizable(self, cash: float) -> float:
        """Efectivo + lo que se obtendría vendiendo ahora cada posición (sin ruta de venta = 0)."""
        total = cash
        for p in self.state.positions:
            try:
                total += raw_to_usd(self.broker.quote_sell(p.mint, p.amount_raw, self.cfg.SLIPPAGE_BPS).out_amount)
            except Exception:
                pass
        return total

    def _manage_exits(self, held: dict[str, PairMetrics]) -> None:
        for p in list(self.state.positions):
            m = held.get(p.mint)
            if m is None:
                continue
            p.peak_price = max(p.peak_price, m.price_usd)
            d = exit_decision(p, m, self.cfg, self.now())
            if d.fraction > 0 and self._sell(p, d.fraction, d.reason, d.emergency) and d.take_profit:
                p.took_profit = True

    def _liquidate(self, reason: str, *, emergency: bool) -> None:
        for p in list(self.state.positions):
            self._sell(p, 1, reason, emergency)

    def _sell(self, p: Position, fraction: float, reason: str, emergency: bool) -> bool:
        amount = p.amount_raw if fraction >= 1 else p.amount_raw * round(fraction * 10_000) // 10_000
        if amount <= 0:
            return False
        try:
            fill = self.execution.close(p.mint, amount, emergency)
        except Exception as e:
            self._report_error(RuntimeError(f"no se pudo vender {p.symbol} ({reason}): {e}"))
            return False
        cost = p.cost_usd * amount / p.amount_raw
        pnl = fill.usd - cost
        p.amount_raw -= amount
        p.cost_usd -= cost
        p.realized_pnl_usd += pnl
        self._record("sell", p.mint, p.symbol, fill.usd, amount, reason, pnl_usd=pnl, signature=fill.signature)
        self.notify(f"🔴 Venta {p.symbol} ({reason}): {fmt_usd(fill.usd)}, resultado {signed_usd(pnl)}")
        if p.amount_raw == 0:
            self._close(p)
        return True

    def _close(self, p: Position) -> None:
        s, cfg, now = self.state, self.cfg, self.now()
        s.positions = [x for x in s.positions if x is not p]
        s.cooldowns[p.mint] = now + cfg.REENTRY_COOLDOWN_HOURS * 3600
        pnl_pct = p.realized_pnl_usd / p.invested_usd * 100 if p.invested_usd else 0
        self.recent.append({"simbolo": p.symbol, "resultado_pct": round(pnl_pct, 1), "tesis": p.thesis[:160]})
        if p.realized_pnl_usd >= 0:
            s.loss_streak = 0
            return
        s.loss_streak += 1
        if s.loss_streak >= cfg.LOSS_STREAK_PAUSE:
            s.loss_streak = 0
            s.paused_until = now + cfg.PAUSE_MINUTES * 60
            self.notify(f"{cfg.LOSS_STREAK_PAUSE} pérdidas seguidas: {cfg.PAUSE_MINUTES:g} min sin comprar.")

    # ---- ciclo de inversión: director → quant → risk → ejecución -------------------------------

    def _free_cash(self) -> float:
        return self.broker.cash_usd() - self.state.pending_withdrawal_usd - self.broker.swap_fee_usd

    def _investment_cycle(self, equity: float, held: dict[str, PairMetrics]) -> None:
        s, cfg, now = self.state, self.cfg, self.now()
        for mint, until in list(s.cooldowns.items()):
            if until <= now:
                del s.cooldowns[mint]
        can_open = (
            now >= s.paused_until
            and len(s.positions) < cfg.MAX_POSITIONS
            and self._free_cash() >= cfg.MIN_TRADE_USD
        )
        if can_open and not self.broker.can_pay_fees():
            can_open = False
            if now - self.last_fee_warning >= 3600:
                self.last_fee_warning = now
                self.notify(f"Falta SOL para las comisiones (mínimo {cfg.SOL_FEE_RESERVE} SOL): no se abren posiciones.")
        exclude = {p.mint for p in s.positions} | set(s.cooldowns)
        candidates = self.scanner.candidates(exclude) if can_open else []
        if not candidates and not s.positions:
            return  # nada que analizar: no se gasta en IA

        try:
            report = self.director.run(candidates, self._portfolio(equity, held), now)
        except BudgetExceeded as e:
            self._budget_warning(e)
            return
        log.info("director: %s", report.market_view)
        for signal in report.close_positions:
            p = next((x for x in s.positions if x.mint == signal.mint), None)
            if p:
                self._sell(p, 1, f"director: {signal.reason}", emergency=False)

        by_mint = {c.metrics.mint: c for c in candidates}
        for thesis in report.theses:
            if not can_open or len(s.positions) >= cfg.MAX_POSITIONS or self._free_cash() < cfg.MIN_TRADE_USD:
                break
            candidate = by_mint[thesis.mint]
            try:
                verdict = self.quant.run(thesis, candidate, now)
                if not verdict.approved:
                    log.info("quant rechazó %s: %s", thesis.symbol, verdict.reasoning)
                    continue
                decision = self.risk.run(thesis, verdict, candidate, self._portfolio(equity, held), now)
            except BudgetExceeded as e:
                self._budget_warning(e)
                return
            except AgentError as e:
                log.warning("%s", e)
                continue
            if not decision.approve or decision.size_pct <= 0:
                log.info("risk manager no aprobó %s: %s", thesis.symbol, decision.rationale)
                continue
            usd = min(
                equity * decision.size_pct / 100,
                candidate.metrics.liquidity_usd * cfg.MAX_POOL_FRACTION,
                self._free_cash(),
            )
            usd = math.floor(usd * 100) / 100
            if usd >= cfg.MIN_TRADE_USD:
                self._open(thesis, candidate, decision, usd)

    def _open(self, thesis: Thesis, c: Candidate, d: RiskDecision, usd: float) -> None:
        m = c.metrics
        try:
            fill = self.execution.open(m.mint, usd)
        except Exception as e:
            self._report_error(RuntimeError(f"falló la compra de {m.symbol}: {e}"))
            return
        if fill is None:
            return
        entry = fill.usd / (fill.amount_raw / 10**c.decimals)
        plan = ExitPlan(
            stop_loss_pct=d.stop_loss_pct,
            take_profit_pct=d.take_profit_pct,
            trailing_stop_pct=d.trailing_stop_pct,
            max_hold_minutes=d.max_hold_minutes,
        )
        self.state.positions.append(
            Position(
                mint=m.mint,
                symbol=m.symbol,
                decimals=c.decimals,
                amount_raw=fill.amount_raw,
                cost_usd=fill.usd,
                invested_usd=fill.usd,
                entry_price=entry,
                entry_liquidity_usd=m.liquidity_usd,
                peak_price=entry,
                opened_at=self.now(),
                plan=plan,
                thesis=thesis.thesis,
            )
        )
        self._record("buy", m.mint, m.symbol, fill.usd, fill.amount_raw, thesis.thesis[:200], signature=fill.signature)
        self.notify(
            f"🟢 Compra {m.symbol}: {fmt_usd(fill.usd)}. Tesis: {thesis.thesis[:200]} "
            f"| stop -{plan.stop_loss_pct:g}% · objetivo +{plan.take_profit_pct:g}%"
        )

    def _portfolio(self, equity: float, held: dict[str, PairMetrics]) -> dict[str, Any]:
        s, cfg, now = self.state, self.cfg, self.now()

        def pnl(p: Position) -> float | None:
            m = held.get(p.mint)
            return round((m.price_usd / p.entry_price - 1) * 100, 1) if m else None

        return {
            "capital_usd": round(equity, 2),
            "efectivo_libre_usd": round(max(self._free_cash(), 0), 2),
            "posiciones": [
                {
                    "mint": p.mint,
                    "simbolo": p.symbol,
                    "resultado_pct": pnl(p),
                    "minutos_abierta": int((now - p.opened_at) / 60),
                    "tesis": p.thesis,
                    "plan": p.plan.model_dump(),
                }
                for p in s.positions
            ],
            "racha_de_perdidas": s.loss_streak,
            "ultimas_operaciones": list(self.recent),
            "metas": {
                "patrimonio_usd": round(wealth(s, equity), 2),
                "retirado_usd": round(s.withdrawn_usd, 2),
                "proxima_meta_usd": next_milestone(s, cfg),
                "objetivo_final_usd": cfg.TARGET_USD,
            },
        }

    # ---- registro y avisos ---------------------------------------------------------------------

    def _record(
        self,
        side: str,
        mint: str,
        symbol: str,
        usd: float,
        amount_raw: int,
        reason: str,
        pnl_usd: float | None = None,
        signature: str | None = None,
    ) -> None:
        self.state.trades += 1
        trade = Trade(
            at=self.now(), side=side, mint=mint, symbol=symbol, usd=usd,  # type: ignore[arg-type]
            amount_raw=amount_raw, reason=reason, pnl_usd=pnl_usd, signature=signature,
        )
        self.store.append_trade(trade)

    def _budget_warning(self, e: Exception) -> None:
        day = datetime.fromtimestamp(self.now(), UTC).strftime("%Y-%m-%d")
        if self.budget_warned_day != day:
            self.budget_warned_day = day
            self.notify(f"{e}. Sin entradas nuevas hasta mañana; las salidas siguen funcionando.")

    def _maybe_summary(self) -> None:
        now = self.now()
        if now - self.last_summary < DAY:
            return
        self.last_summary = now
        s = self.state
        self.notify(
            f"Resumen diario: patrimonio {fmt_usd(wealth(s, s.last_equity_usd))} "
            f"(retirado {fmt_usd(s.withdrawn_usd)}), próxima meta {fmt_usd(next_milestone(s, self.cfg))}, "
            f"{len(s.positions)} posiciones, gasto en IA hoy {fmt_usd(s.llm_spent_today_usd)}."
        )

    def _report_error(self, e: Exception) -> None:
        """Siempre queda en el log; por Telegram, como mucho un aviso cada 10 minutos."""
        log.error("%s", e)
        now = self.now()
        if now - self.last_error >= 600:
            self.last_error = now
            self.notify(f"⚠️ {e}")
