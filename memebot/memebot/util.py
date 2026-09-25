from __future__ import annotations

import logging
from typing import Any

import httpx

log = logging.getLogger("memebot")


def get_json(
    http: httpx.Client,
    url: str,
    *,
    params: dict[str, str] | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 10.0,
) -> Any:
    r = http.get(url, params=params, headers=headers, timeout=timeout)
    r.raise_for_status()
    return r.json()


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def fmt_usd(n: float) -> str:
    s = f"{abs(n):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{'-' if n < 0 else ''}US${s}"


def signed_usd(n: float) -> str:
    return f"{'+' if n >= 0 else '-'}{fmt_usd(abs(n))}"
