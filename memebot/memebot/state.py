"""Persistencia: estado en data/state-<modo>.json (escritura atómica) y operaciones en data/trades-<modo>.jsonl."""

from __future__ import annotations

import os
from pathlib import Path

from .models import State, Trade


class Store:
    def __init__(self, directory: str, mode: str):
        self.dir = Path(directory)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.mode = mode
        self.state_path = self.dir / f"state-{mode}.json"
        self.trades_path = self.dir / f"trades-{mode}.jsonl"
        self.panic_path = self.dir / "PANIC"

    def load(self) -> State | None:
        if not self.state_path.exists():
            return None
        return State.model_validate_json(self.state_path.read_text())

    def save(self, state: State) -> None:
        tmp = self.state_path.with_suffix(".json.tmp")
        tmp.write_text(state.model_dump_json(indent=2))
        os.replace(tmp, self.state_path)

    def append_trade(self, trade: Trade) -> None:
        with self.trades_path.open("a") as f:
            f.write(trade.model_dump_json() + "\n")

    def panic(self) -> bool:
        return self.panic_path.exists()

    def set_panic(self, on: bool) -> None:
        if on:
            self.panic_path.write_text("pánico")
        else:
            self.panic_path.unlink(missing_ok=True)

    def archive(self, now: float) -> Path | None:
        """Guarda el estado con otro nombre (no lo borra) para empezar de cero."""
        if not self.state_path.exists():
            return None
        dest = self.dir / f"state-{self.mode}.{int(now)}.bak.json"
        os.replace(self.state_path, dest)
        return dest
