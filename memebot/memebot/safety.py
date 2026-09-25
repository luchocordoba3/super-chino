"""Controles anti-estafa. Ante cualquier duda, la moneda se descarta."""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx

from .chain import SolanaRpc
from .util import get_json


@dataclass
class SafetyReport:
    ok: bool
    reason: str = ""
    decimals: int | None = None
    warnings: list[str] = field(default_factory=list)
    transient: bool = False  # falla pasajera (red caída): no se guarda en caché


class Safety(Protocol):
    def check(self, mint: str) -> SafetyReport: ...


# Extensiones de Token-2022 que permiten cobrar, bloquear o quitar monedas al que las tiene.
DANGEROUS_EXTENSIONS = {"transferFeeConfig", "transferHook", "permanentDelegate", "nonTransferable", "pausableConfig"}


def evaluate_mint(data: Any) -> SafetyReport:
    """Evalúa la cuenta del mint tal como la devuelve `getAccountInfo` con `jsonParsed`."""
    parsed = data.get("parsed") if isinstance(data, dict) else None
    if not isinstance(parsed, dict) or parsed.get("type") != "mint":
        return SafetyReport(False, "no es un token")
    info = parsed.get("info")
    if (
        not isinstance(info, dict)
        or "mintAuthority" not in info
        or "freezeAuthority" not in info
        or not isinstance(info.get("decimals"), int)
    ):
        return SafetyReport(False, "datos del token ilegibles")
    if info["mintAuthority"]:
        return SafetyReport(False, "alguien puede emitir más monedas")
    if info["freezeAuthority"]:
        return SafetyReport(False, "alguien puede congelar monedas")
    for ext in info.get("extensions") or []:
        name = ext.get("extension") if isinstance(ext, dict) else None
        frozen_by_default = name == "defaultAccountState" and "frozen" in json.dumps(ext.get("state", ""))
        if name in DANGEROUS_EXTENSIONS or frozen_by_default:
            return SafetyReport(False, f"extensión peligrosa: {name}")
    return SafetyReport(True, decimals=info["decimals"])


def evaluate_rugcheck(payload: Any) -> SafetyReport:
    """Rechaza los riesgos "danger"; los "warn" pasan como alertas para los agentes."""
    risks = payload.get("risks") if isinstance(payload, dict) else None
    if not isinstance(risks, list):
        return SafetyReport(False, "RugCheck: respuesta ilegible")

    def names(level: str) -> list[str]:
        return [str(r.get("name", "?")) for r in risks if isinstance(r, dict) and r.get("level") == level]

    danger = names("danger")
    if danger:
        return SafetyReport(False, f"RugCheck: {danger[0]}")
    return SafetyReport(True, warnings=names("warn"))


class ChainSafety:
    def __init__(
        self,
        rpc: SolanaRpc,
        http: httpx.Client,
        rugcheck_url: str,
        ttl_seconds: float = 1800,
        now: Callable[[], float] = time.time,
    ):
        self.rpc, self.http, self.rugcheck_url = rpc, http, rugcheck_url
        self.ttl, self.now = ttl_seconds, now
        self.cache: dict[str, tuple[float, SafetyReport]] = {}

    def check(self, mint: str) -> SafetyReport:
        hit = self.cache.get(mint)
        if hit and self.now() - hit[0] < self.ttl:
            return hit[1]
        report = self._evaluate(mint)
        if not report.transient:
            self.cache[mint] = (self.now(), report)
        return report

    def _evaluate(self, mint: str) -> SafetyReport:
        try:
            on_chain = evaluate_mint(self.rpc.parsed_account(mint))
        except Exception as e:
            return SafetyReport(False, f"RPC: {e}", transient=True)
        if not on_chain.ok:
            return on_chain
        try:
            rug = evaluate_rugcheck(get_json(self.http, f"{self.rugcheck_url}/v1/tokens/{mint}/report/summary"))
        except Exception as e:
            return SafetyReport(False, f"RugCheck no respondió: {e}", transient=True)
        if not rug.ok:
            return rug
        return SafetyReport(True, decimals=on_chain.decimals, warnings=rug.warnings)
