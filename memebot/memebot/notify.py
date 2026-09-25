from __future__ import annotations

import httpx

from .config import Config
from .util import log


class Notifier:
    """Escribe en el log y, si está configurado, avisa por Telegram. Nunca lanza errores."""

    def __init__(self, cfg: Config, http: httpx.Client | None = None):
        self.cfg, self.http = cfg, http

    def __call__(self, msg: str) -> None:
        log.info(msg)
        token, chat = self.cfg.TELEGRAM_BOT_TOKEN, self.cfg.TELEGRAM_CHAT_ID
        if not (token and chat and self.http):
            return
        try:
            r = self.http.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                json={"chat_id": chat, "text": f"[memebot {self.cfg.MODE}] {msg}"},
                timeout=10,
            )
            if r.status_code >= 400:
                log.warning("Telegram respondió %s", r.status_code)
        except Exception:
            # No se registra la URL: lleva el token del bot.
            log.warning("no se pudo avisar por Telegram")
