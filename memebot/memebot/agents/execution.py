"""Agente de ejecución: el único que mueve fondos.

No usa IA. Ejecuta exactamente lo que aprobó el risk manager, dentro de topes fijos:
cotiza, controla el impacto en el precio, firma, envía y confirma. Los retiros solo
pueden ir a WITHDRAW_ADDRESS, que sale de la configuración y nunca de un agente.
"""

from __future__ import annotations

import base64
import math
import time
from dataclasses import dataclass
from typing import Any, Protocol

import httpx
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.transaction import VersionedTransaction

from ..chain import SolanaRpc, raw_to_usd, usd_to_raw, usdc_transfer_tx
from ..config import Config
from ..market import USDC_MINT
from ..models import State
from ..util import get_json, log


@dataclass
class Quote:
    in_amount: int
    out_amount: int
    raw: dict[str, Any]  # respuesta original de Jupiter: se devuelve tal cual para armar la transacción


@dataclass
class Fill:
    amount_raw: int
    usd: float
    signature: str | None = None


class Quoter(Protocol):
    def quote(self, input_mint: str, output_mint: str, amount: int, slippage_bps: int) -> Quote: ...


class Jupiter:
    """Jupiter Swap API v1: busca la mejor ruta entre todos los DEX de Solana."""

    def __init__(self, http: httpx.Client, base_url: str, api_key: str | None = None):
        self.http, self.base_url = http, base_url.rstrip("/")
        self.headers = {"x-api-key": api_key} if api_key else {}

    def quote(self, input_mint: str, output_mint: str, amount: int, slippage_bps: int) -> Quote:
        params = {
            "inputMint": input_mint,
            "outputMint": output_mint,
            "amount": str(amount),
            "slippageBps": str(slippage_bps),
            "restrictIntermediateTokens": "true",
        }
        raw = get_json(self.http, f"{self.base_url}/swap/v1/quote", params=params, headers=self.headers)
        return Quote(int(raw["inAmount"]), int(raw["outAmount"]), raw)

    def swap_transaction(self, quote_raw: dict[str, Any], user: str, max_priority_lamports: int) -> tuple[str, int]:
        body = {
            "quoteResponse": quote_raw,
            "userPublicKey": user,
            "wrapAndUnwrapSol": True,
            "dynamicComputeUnitLimit": True,
            "prioritizationFeeLamports": {
                "priorityLevelWithMaxLamports": {"maxLamports": max_priority_lamports, "priorityLevel": "veryHigh"}
            },
        }
        r = self.http.post(f"{self.base_url}/swap/v1/swap", json=body, headers=self.headers, timeout=20)
        r.raise_for_status()
        data = r.json()
        return data["swapTransaction"], int(data["lastValidBlockHeight"])


class Broker(Protocol):
    swap_fee_usd: float

    def cash_usd(self) -> float: ...
    def quote_buy(self, mint: str, usd: float, slippage_bps: int) -> Quote: ...
    def quote_sell(self, mint: str, amount_raw: int, slippage_bps: int) -> Quote: ...
    def buy(self, mint: str, quote: Quote) -> Fill: ...
    def sell(self, mint: str, amount_raw: int, slippage_bps: int) -> Fill: ...
    def withdraw(self, usd: float) -> str | None: ...
    def can_pay_fees(self) -> bool: ...


class PaperBroker:
    """Simulación: cotizaciones reales, dinero virtual. Descuenta una comisión y un slippage fijo."""

    def __init__(self, quoter: Quoter, wallet: State, fee_usd: float, slippage_pct: float):
        self.quoter, self.wallet = quoter, wallet
        self.swap_fee_usd, self.slippage_pct = fee_usd, slippage_pct

    def cash_usd(self) -> float:
        return self.wallet.cash_usd

    def quote_buy(self, mint: str, usd: float, slippage_bps: int) -> Quote:
        return self.quoter.quote(USDC_MINT, mint, usd_to_raw(usd), slippage_bps)

    def quote_sell(self, mint: str, amount_raw: int, slippage_bps: int) -> Quote:
        return self.quoter.quote(mint, USDC_MINT, amount_raw, slippage_bps)

    def buy(self, mint: str, quote: Quote) -> Fill:
        usd = raw_to_usd(quote.in_amount) + self.swap_fee_usd
        if usd > self.wallet.cash_usd + 1e-9:
            raise RuntimeError("saldo insuficiente")
        self.wallet.cash_usd -= usd
        return Fill(self._haircut(quote.out_amount), usd)

    def sell(self, mint: str, amount_raw: int, slippage_bps: int) -> Fill:
        q = self.quote_sell(mint, amount_raw, slippage_bps)
        usd = max(0.0, raw_to_usd(self._haircut(q.out_amount)) - self.swap_fee_usd)
        self.wallet.cash_usd += usd
        return Fill(amount_raw, usd)

    def withdraw(self, usd: float) -> str | None:
        if usd > self.wallet.cash_usd + 1e-9:
            raise RuntimeError("saldo insuficiente para el retiro")
        self.wallet.cash_usd -= usd
        return None

    def can_pay_fees(self) -> bool:
        return True

    def _haircut(self, amount: int) -> int:
        return amount * round((100 - self.slippage_pct) * 100) // 10_000


class LiveBroker:
    """Operación real: firma las transacciones de Jupiter y registra lo que de verdad cambió en la billetera."""

    swap_fee_usd = 0.0

    def __init__(self, jupiter: Jupiter, rpc: SolanaRpc, keypair: Keypair, withdraw_to: Pubkey, cfg: Config):
        self.jupiter, self.rpc, self.keypair, self.withdraw_to, self.cfg = jupiter, rpc, keypair, withdraw_to, cfg
        self.owner = str(keypair.pubkey())

    def cash_usd(self) -> float:
        return raw_to_usd(self.rpc.token_balance(self.owner, USDC_MINT))

    def sol_balance(self) -> float:
        return self.rpc.sol_balance(self.owner) / 1e9

    def can_pay_fees(self) -> bool:
        return self.sol_balance() >= self.cfg.SOL_FEE_RESERVE

    def quote_buy(self, mint: str, usd: float, slippage_bps: int) -> Quote:
        return self.jupiter.quote(USDC_MINT, mint, usd_to_raw(usd), slippage_bps)

    def quote_sell(self, mint: str, amount_raw: int, slippage_bps: int) -> Quote:
        return self.jupiter.quote(mint, USDC_MINT, amount_raw, slippage_bps)

    def buy(self, mint: str, quote: Quote) -> Fill:
        token_before = self.rpc.token_balance(self.owner, mint)
        usdc_before = self.rpc.token_balance(self.owner, USDC_MINT)
        signature = self._swap(quote)
        token_after = self._wait_change(mint, token_before)
        usdc_after = self.rpc.token_balance(self.owner, USDC_MINT)
        return Fill(token_after - token_before, raw_to_usd(usdc_before - usdc_after), signature)

    def sell(self, mint: str, amount_raw: int, slippage_bps: int) -> Fill:
        quote = self.quote_sell(mint, amount_raw, slippage_bps)
        token_before = self.rpc.token_balance(self.owner, mint)
        usdc_before = self.rpc.token_balance(self.owner, USDC_MINT)
        signature = self._swap(quote)
        token_after = self._wait_change(mint, token_before)
        usdc_after = self.rpc.token_balance(self.owner, USDC_MINT)
        return Fill(token_before - token_after, raw_to_usd(usdc_after - usdc_before), signature)

    def withdraw(self, usd: float) -> str | None:
        amount = usd_to_raw(usd)
        before = self.rpc.token_balance(self.owner, USDC_MINT)
        blockhash, last_valid = self.rpc.latest_blockhash()
        tx = usdc_transfer_tx(self.keypair, self.withdraw_to, amount, blockhash)
        signature = self.rpc.send(bytes(tx))
        if self.rpc.wait_confirmed(signature, last_valid):
            return signature
        # Sin confirmación: el saldo decide si salió, para no retirar dos veces.
        if before - self.rpc.token_balance(self.owner, USDC_MINT) >= amount * 0.99:
            return signature
        raise RuntimeError(f"el retiro {signature} no se confirmó")

    def reconcile(self, state: State) -> None:
        """Al arrancar: ajusta las posiciones guardadas a lo que realmente hay en la billetera."""
        state.cash_usd = self.cash_usd()
        for p in list(state.positions):
            balance = self.rpc.token_balance(self.owner, p.mint)
            if balance == 0:
                state.positions = [x for x in state.positions if x is not p]
                log.warning("%s ya no está en la billetera: se quita de las posiciones", p.symbol)
            elif balance != p.amount_raw:
                p.amount_raw = balance

    def _swap(self, quote: Quote) -> str:
        tx_b64, last_valid = self.jupiter.swap_transaction(quote.raw, self.owner, self.cfg.MAX_PRIORITY_FEE_LAMPORTS)
        unsigned = VersionedTransaction.from_bytes(base64.b64decode(tx_b64))
        signed = VersionedTransaction(unsigned.message, [self.keypair])
        signature = self.rpc.send(bytes(signed))
        if not self.rpc.wait_confirmed(signature, last_valid):
            log.warning("sin confirmación de %s: lo decide el saldo", signature)
        return signature

    def _wait_change(self, mint: str, before: int) -> int:
        for _ in range(15):
            now = self.rpc.token_balance(self.owner, mint)
            if now != before:
                return now
            time.sleep(2)
        raise RuntimeError("la operación no se reflejó en la billetera")


class ExecutionAgent:
    def __init__(self, broker: Broker, cfg: Config):
        self.broker, self.cfg = broker, cfg

    def sellable(self, mint: str, price_usd: float, decimals: int) -> bool:
        """Venta de prueba por ~US$1: si no hay ruta o devuelve casi nada, es una trampa."""
        try:
            probe = int(10**decimals / price_usd)
            return raw_to_usd(self.broker.quote_sell(mint, probe, self.cfg.SLIPPAGE_BPS).out_amount) >= 0.5
        except Exception as e:
            log.info("%s: sin ruta de venta (%s)", mint, e)
            return False

    def open(self, mint: str, usd: float) -> Fill | None:
        """Compra hasta `usd`. Si el impacto en el precio supera el tope, prueba con la mitad; si sigue alto, no compra."""
        bps = self.cfg.SLIPPAGE_BPS

        def rate(q: Quote) -> float:
            return q.out_amount / raw_to_usd(q.in_amount)

        ref = self.broker.quote_buy(mint, 1, bps)
        for _ in range(2):
            if usd < self.cfg.MIN_TRADE_USD:
                break
            q = self.broker.quote_buy(mint, usd, bps)
            if (1 - rate(q) / rate(ref)) * 100 <= self.cfg.MAX_PRICE_IMPACT_PCT:
                fill = self.broker.buy(mint, q)
                if fill.amount_raw <= 0:
                    raise RuntimeError("no se recibieron monedas")
                return fill
            usd = math.floor(usd * 50) / 100  # la mitad, en centavos
        log.info("%s: impacto en el precio demasiado alto, no se compra", mint)
        return None

    def close(self, mint: str, amount_raw: int, emergency: bool) -> Fill:
        """Vende; si falla, reintenta subiendo el slippage (hasta 3 intentos)."""
        cfg = self.cfg
        mid = (cfg.SLIPPAGE_BPS + cfg.EMERGENCY_SLIPPAGE_BPS) // 2
        attempts = [cfg.EMERGENCY_SLIPPAGE_BPS] * 3 if emergency else [cfg.SLIPPAGE_BPS, mid, cfg.EMERGENCY_SLIPPAGE_BPS]
        error: Exception | None = None
        for bps in attempts:
            try:
                return self.broker.sell(mint, amount_raw, bps)
            except Exception as e:
                error = e
        raise RuntimeError(str(error))

    def withdraw(self, usd: float) -> str | None:
        return self.broker.withdraw(usd)
