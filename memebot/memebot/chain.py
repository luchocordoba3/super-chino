"""Solana: RPC JSON por HTTP y armado de la transferencia de USDC para los retiros."""

from __future__ import annotations

import base64
import json
import time
from collections.abc import Callable
from typing import Any

import httpx
from solders.hash import Hash
from solders.instruction import AccountMeta, Instruction
from solders.keypair import Keypair
from solders.message import MessageV0
from solders.pubkey import Pubkey
from solders.token.associated import get_associated_token_address
from solders.transaction import VersionedTransaction

from .market import USDC_MINT

USDC_DECIMALS = 6
TOKEN_PROGRAM = Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
ATA_PROGRAM = Pubkey.from_string("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
SYSTEM_PROGRAM = Pubkey.from_string("11111111111111111111111111111111")
COMPUTE_BUDGET_PROGRAM = Pubkey.from_string("ComputeBudget111111111111111111111111111111")


def usd_to_raw(usd: float) -> int:
    return int(usd * 10**USDC_DECIMALS)


def raw_to_usd(raw: int) -> float:
    return raw / 10**USDC_DECIMALS


def load_keypair(secret: str) -> Keypair:
    """Acepta la clave en base58 (Phantom, Solflare) o como arreglo JSON (solana-keygen)."""
    s = secret.strip()
    if s.startswith("["):
        return Keypair.from_bytes(bytes(json.loads(s)))
    return Keypair.from_base58_string(s)


class RpcError(RuntimeError):
    pass


class SolanaRpc:
    def __init__(self, url: str, http: httpx.Client):
        self.url = url
        self.http = http

    def call(self, method: str, params: list[Any]) -> Any:
        r = self.http.post(self.url, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, timeout=20)
        r.raise_for_status()
        body = r.json()
        if "error" in body:
            raise RpcError(f"{method}: {body['error']}")
        return body["result"]

    def parsed_account(self, address: str) -> dict[str, Any] | None:
        value = self.call("getAccountInfo", [address, {"encoding": "jsonParsed", "commitment": "confirmed"}])["value"]
        return value.get("data") if value else None

    def token_balance(self, owner: str, mint: str) -> int:
        res = self.call(
            "getTokenAccountsByOwner", [owner, {"mint": mint}, {"encoding": "jsonParsed", "commitment": "confirmed"}]
        )
        return sum(int(a["account"]["data"]["parsed"]["info"]["tokenAmount"]["amount"]) for a in res["value"])

    def sol_balance(self, owner: str) -> int:
        return int(self.call("getBalance", [owner, {"commitment": "confirmed"}])["value"])

    def latest_blockhash(self) -> tuple[str, int]:
        v = self.call("getLatestBlockhash", [{"commitment": "confirmed"}])["value"]
        return v["blockhash"], int(v["lastValidBlockHeight"])

    def send(self, tx: bytes) -> str:
        opts = {"encoding": "base64", "skipPreflight": True, "maxRetries": 3}
        return self.call("sendTransaction", [base64.b64encode(tx).decode(), opts])

    def wait_confirmed(
        self, signature: str, last_valid_block_height: int, sleep: Callable[[float], None] = time.sleep
    ) -> bool:
        """True si se confirmó; False si venció sin entrar. Lanza error si entró pero falló."""
        for _ in range(90):
            status = self.call("getSignatureStatuses", [[signature]])["value"][0]
            if status and status.get("confirmationStatus") in ("confirmed", "finalized"):
                if status.get("err"):
                    raise RpcError(f"la transacción {signature} falló: {status['err']}")
                return True
            if int(self.call("getBlockHeight", [{"commitment": "confirmed"}])) > last_valid_block_height:
                return False
            sleep(2)
        return False


def usdc_transfer_instructions(owner: Pubkey, destination: Pubkey, amount_raw: int) -> list[Instruction]:
    """Transfiere USDC a la billetera `destination`; crea su cuenta de USDC si todavía no la tiene."""
    mint = Pubkey.from_string(USDC_MINT)
    source_ata = get_associated_token_address(owner, mint)
    dest_ata = get_associated_token_address(destination, mint)
    priority = Instruction(COMPUTE_BUDGET_PROGRAM, bytes([3]) + (100_000).to_bytes(8, "little"), [])
    create_dest = Instruction(
        ATA_PROGRAM,
        bytes([1]),  # CreateIdempotent: no falla si la cuenta ya existe
        [
            AccountMeta(owner, True, True),
            AccountMeta(dest_ata, False, True),
            AccountMeta(destination, False, False),
            AccountMeta(mint, False, False),
            AccountMeta(SYSTEM_PROGRAM, False, False),
            AccountMeta(TOKEN_PROGRAM, False, False),
        ],
    )
    transfer = Instruction(
        TOKEN_PROGRAM,
        bytes([12]) + amount_raw.to_bytes(8, "little") + bytes([USDC_DECIMALS]),  # TransferChecked
        [
            AccountMeta(source_ata, False, True),
            AccountMeta(mint, False, False),
            AccountMeta(dest_ata, False, True),
            AccountMeta(owner, True, False),
        ],
    )
    return [priority, create_dest, transfer]


def usdc_transfer_tx(keypair: Keypair, destination: Pubkey, amount_raw: int, blockhash: str) -> VersionedTransaction:
    ixs = usdc_transfer_instructions(keypair.pubkey(), destination, amount_raw)
    msg = MessageV0.try_compile(keypair.pubkey(), ixs, [], Hash.from_string(blockhash))
    return VersionedTransaction(msg, [keypair])
