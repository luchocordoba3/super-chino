"""Uso: python -m memebot {start,status,panic,resume,reset} [--paper] [--yes]"""

from __future__ import annotations

import argparse
import logging
import os
import signal
import sys
import threading
import time
from datetime import datetime
from pathlib import Path

import anthropic
import httpx
from solders.pubkey import Pubkey

from .agents.director import Director
from .agents.execution import ExecutionAgent, Jupiter, LiveBroker, PaperBroker
from .agents.llm import ClaudeLLM
from .agents.quant import Quant
from .agents.risk import RiskManager
from .bot import Agents, Bot
from .chain import SolanaRpc, load_keypair
from .config import Config, load_config
from .goals import next_milestone, wealth
from .learning import Journal
from .market import LiveMarket
from .models import State
from .notify import Notifier
from .safety import ChainSafety
from .scanner import Scanner
from .state import Store
from .util import fmt_usd, log

STATUS = {"running": "operando", "won": "GANÓ: objetivo final cumplido", "busted": "QUEBRÓ: capital agotado"}


def start(cfg: Config, store: Store) -> int:
    stop = threading.Event()

    def on_signal(signum: int, frame: object) -> None:
        # La primera señal termina el ciclo en curso y guarda; la segunda corta en seco.
        if stop.is_set():
            os._exit(130)
        stop.set()

    signal.signal(signal.SIGINT, on_signal)
    signal.signal(signal.SIGTERM, on_signal)

    http = httpx.Client(timeout=15, headers={"user-agent": "memebot/0.2"})
    rpc = SolanaRpc(cfg.SOLANA_RPC_URL, http)
    jupiter = Jupiter(http, cfg.JUP_API_URL, cfg.JUP_API_KEY)
    state = store.load()
    if cfg.MODE == "live":
        if not cfg.WALLET_PRIVATE_KEY or not cfg.WITHDRAW_ADDRESS:
            log.error("MODE=live necesita WALLET_PRIVATE_KEY y WITHDRAW_ADDRESS en el .env")
            return 1
        keypair = load_keypair(cfg.WALLET_PRIVATE_KEY)
        withdraw_to = Pubkey.from_string(cfg.WITHDRAW_ADDRESS)
        if withdraw_to == keypair.pubkey():
            log.error("WITHDRAW_ADDRESS tiene que ser otra billetera, no la del bot")
            return 1
        broker = LiveBroker(jupiter, rpc, keypair, withdraw_to, cfg)
        usdc, sol = broker.cash_usd(), broker.sol_balance()
        log.warning(
            "MODO REAL, con dinero de verdad. Billetera %s: %s en USDC y %.4f SOL. Retiros a %s.",
            broker.owner,
            fmt_usd(usdc),
            sol,
            withdraw_to,
        )
        state = state or State.fresh("live", usdc, time.time())
        broker.reconcile(state)
    else:
        state = state or State.fresh("paper", cfg.PAPER_START_USD, time.time())
        broker = PaperBroker(jupiter, state, cfg.PAPER_FEE_USD, cfg.PAPER_SLIPPAGE_PCT)

    if state.status == "running":
        if not os.environ.get("ANTHROPIC_API_KEY"):
            log.warning(
                "No hay ANTHROPIC_API_KEY: si no configuraste credenciales de otra forma, los agentes van a fallar"
            )
        llm = ClaudeLLM(anthropic.Anthropic(timeout=120.0, max_retries=2), state, cfg.LLM_DAILY_BUDGET_USD)
        execution = ExecutionAgent(broker, cfg)
        journal = Journal(Path(cfg.DATA_DIR) / "learning.json")
        safety = ChainSafety(rpc, http, cfg.RUGCHECK_API_URL)
        scanner = Scanner(LiveMarket(http), safety, execution, cfg, journal=journal)
        agents = Agents(Director(llm, cfg), Quant(llm, cfg), RiskManager(llm, cfg), execution)
        bot = Bot(
            cfg=cfg,
            state=state,
            store=store,
            scanner=scanner,
            agents=agents,
            journal=journal,
            notify=Notifier(cfg, http),
        )
        bot.run(stop)
        if state.status == "running":
            return 0  # detenido con Ctrl+C o por Docker
    log.info("Este bot terminó (%s) y no vuelve a operar. Para empezar de cero: reset --yes", STATUS[state.status])
    if os.environ.get("IDLE_AFTER_END") == "1":
        stop.wait()  # en Docker queda en reposo: si saliera, el contenedor se reiniciaría en bucle
    return 0


def status(cfg: Config, store: Store) -> int:
    s = store.load()
    if s is None:
        print(f"Todavía no hay estado en {store.state_path}. Arrancá con: python -m memebot start")
        return 0
    total = wealth(s, s.last_equity_usd)
    lines = [
        f"Modo: {'REAL' if s.mode == 'live' else 'simulación'} | Estado: {STATUS[s.status]}"
        + (" | PÁNICO ACTIVADO" if store.panic() else ""),
        f"Patrimonio: {fmt_usd(total)} ({total / cfg.TARGET_USD * 100:.2f}% de {fmt_usd(cfg.TARGET_USD)})",
        f"Capital en el bot: {fmt_usd(s.last_equity_usd)} | Retirado: {fmt_usd(s.withdrawn_usd)}"
        + (f" | Por retirar: {fmt_usd(s.pending_withdrawal_usd)}" if s.pending_withdrawal_usd >= 0.01 else ""),
        (
            f"Metas alcanzadas: {', '.join(fmt_usd(m) for m in s.milestones_hit) or 'ninguna'} | "
            f"Próxima: {fmt_usd(next_milestone(s, cfg))}"
        ),
        (
            f"Gasto en IA: hoy {fmt_usd(s.llm_spent_today_usd)} de {fmt_usd(cfg.LLM_DAILY_BUDGET_USD)}, "
            f"total {fmt_usd(s.llm_spent_total_usd)} | Operaciones: {s.trades}"
        ),
    ]
    for p in s.positions:
        opened = datetime.fromtimestamp(p.opened_at).strftime("%d/%m %H:%M")
        lines.append(f"  • {p.symbol}: costo {fmt_usd(p.cost_usd)}, stop -{p.plan.stop_loss_pct:g}%, desde {opened}")
    journal = Journal(Path(cfg.DATA_DIR) / "learning.json")
    lines.append(f"Aprendizaje: {len(journal.pending())} monedas en seguimiento, {len(journal.lessons)} lecciones")
    lines.extend(f"  • {x}" for x in journal.lessons)
    if s.paused_until > time.time():
        lines.append(f"En pausa hasta {datetime.fromtimestamp(s.paused_until).strftime('%d/%m %H:%M')}")
    print("\n".join(lines))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="memebot")
    parser.add_argument("command", choices=["start", "status", "panic", "resume", "reset"], nargs="?", default="start")
    parser.add_argument("--paper", action="store_true", help="forzar modo simulación")
    parser.add_argument("--yes", action="store_true", help="confirmar reset")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    for noisy in ("httpx", "httpcore", "anthropic"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    cfg = load_config()
    if args.paper:
        cfg.MODE = "paper"
    store = Store(cfg.DATA_DIR, cfg.MODE)
    if args.command == "start":
        return start(cfg, store)
    if args.command == "status":
        return status(cfg, store)
    if args.command == "panic":
        store.set_panic(True)
        print("Pánico activado: en el próximo ciclo el bot vende todo y deja de comprar. Para seguir: resume")
        return 0
    if args.command == "resume":
        store.set_panic(False)
        print("Pánico desactivado: el bot vuelve a buscar entradas.")
        return 0
    if not args.yes:
        print("Esto archiva el estado y el bot empieza de cero. Detené el bot y confirmá con: reset --yes")
        return 1
    dest = store.archive(time.time())
    print(f"Estado archivado en {dest}" if dest else "No había estado para archivar.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
