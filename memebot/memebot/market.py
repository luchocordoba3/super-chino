"""Datos de mercado: GeckoTerminal y DexScreener (APIs públicas, sin clave)."""

from __future__ import annotations

from typing import Any, Protocol

import httpx
from pydantic import BaseModel, ValidationError

from .models import PairMetrics
from .util import get_json, log

SOL_MINT = "So11111111111111111111111111111111111111112"
USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
QUOTE_MINTS = {SOL_MINT, USDC_MINT}


class Market(Protocol):
    def discover(self) -> list[str]:
        """Monedas que conviene mirar ahora (en tendencia o recién promocionadas)."""
        ...

    def metrics(self, mints: list[str]) -> dict[str, PairMetrics]: ...


class _Token(BaseModel):
    address: str
    symbol: str = "?"


class _Txns(BaseModel):
    buys: int = 0
    sells: int = 0


class _TxnWindows(BaseModel):
    m5: _Txns | None = None
    h1: _Txns | None = None


class _Windows(BaseModel):
    m5: float | None = None
    h1: float | None = None
    h6: float | None = None
    h24: float | None = None


class _Liquidity(BaseModel):
    usd: float


class _DexPair(BaseModel):
    chainId: str
    baseToken: _Token
    quoteToken: _Token
    priceUsd: float
    txns: _TxnWindows = _TxnWindows()
    volume: _Windows = _Windows()
    priceChange: _Windows = _Windows()
    liquidity: _Liquidity
    fdv: float | None = None
    marketCap: float | None = None
    pairCreatedAt: float


def best_pairs(payload: Any) -> dict[str, PairMetrics]:
    """Por cada moneda se queda con su par contra SOL o USDC de mayor liquidez. Descarta los pares incompletos."""
    items = payload if isinstance(payload, list) else payload.get("pairs") if isinstance(payload, dict) else None
    out: dict[str, PairMetrics] = {}
    for item in items if isinstance(items, list) else []:
        try:
            p = _DexPair.model_validate(item)
        except ValidationError:
            continue
        if p.chainId != "solana" or p.quoteToken.address not in QUOTE_MINTS:
            continue
        m5, h1 = p.txns.m5 or _Txns(), p.txns.h1 or _Txns()
        m = PairMetrics(
            mint=p.baseToken.address,
            symbol=p.baseToken.symbol,
            price_usd=p.priceUsd,
            liquidity_usd=p.liquidity.usd,
            market_cap_usd=p.marketCap or p.fdv or 0,
            volume_m5=p.volume.m5 or 0,
            volume_h1=p.volume.h1 or 0,
            volume_h24=p.volume.h24 or 0,
            change_m5=p.priceChange.m5 or 0,
            change_h1=p.priceChange.h1 or 0,
            change_h6=p.priceChange.h6 or 0,
            change_h24=p.priceChange.h24 or 0,
            buys_m5=m5.buys,
            sells_m5=m5.sells,
            buys_h1=h1.buys,
            sells_h1=h1.sells,
            created_at=p.pairCreatedAt / 1000,
        )
        prev = out.get(m.mint)
        if prev is None or m.liquidity_usd > prev.liquidity_usd:
            out[m.mint] = m
    return out


def dexscreener_mints(payload: Any) -> list[str]:
    """Monedas de Solana en las listas de promocionadas / perfiles recientes de DexScreener."""
    items = payload if isinstance(payload, list) else [payload]
    return [
        i["tokenAddress"]
        for i in items
        if isinstance(i, dict) and i.get("chainId") == "solana" and isinstance(i.get("tokenAddress"), str)
    ]


def gecko_mints(payload: Any) -> list[str]:
    """Moneda base de los pools en tendencia de GeckoTerminal (ids con forma `solana_<mint>`)."""
    data = payload.get("data") if isinstance(payload, dict) else None
    out = []
    for pool in data if isinstance(data, list) else []:
        try:
            token_id = pool["relationships"]["base_token"]["data"]["id"]
        except (KeyError, TypeError):
            continue
        if isinstance(token_id, str) and token_id.startswith("solana_"):
            out.append(token_id.removeprefix("solana_"))
    return out


class LiveMarket:
    SOURCES = [
        ("https://api.geckoterminal.com/api/v2/networks/solana/trending_pools", gecko_mints),
        ("https://api.dexscreener.com/token-boosts/latest/v1", dexscreener_mints),
        ("https://api.dexscreener.com/token-profiles/latest/v1", dexscreener_mints),
    ]

    def __init__(self, http: httpx.Client):
        self.http = http

    def discover(self) -> list[str]:
        mints: dict[str, None] = {}  # conjunto que conserva el orden
        for url, parse in self.SOURCES:
            try:
                for m in parse(get_json(self.http, url)):
                    mints.setdefault(m)
            except Exception as e:
                log.warning("fuente %s falló: %s", url, e)
        for q in QUOTE_MINTS:
            mints.pop(q, None)
        return list(mints)

    def metrics(self, mints: list[str]) -> dict[str, PairMetrics]:
        """DexScreener acepta hasta 30 monedas por consulta."""
        out: dict[str, PairMetrics] = {}
        for i in range(0, len(mints), 30):
            chunk = ",".join(mints[i : i + 30])
            out.update(best_pairs(get_json(self.http, f"https://api.dexscreener.com/tokens/v1/solana/{chunk}")))
        return out
