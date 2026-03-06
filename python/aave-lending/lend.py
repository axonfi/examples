"""Aave V3 Lending — Supply and withdraw USDC via Axon vault.

Demonstrates execute() with a token NOT in Axon's built-in list.
Aave on Base Sepolia uses its own test USDC (0xba50Cd2A...), not Circle's.
This shows how to work with arbitrary ERC-20 addresses.

The vault is the depositor — aTokens (aUSDC) accrue in the vault,
and only the owner can withdraw. The bot never holds funds.

Setup (one-time):
  1. Deploy vault on Base Sepolia
  2. Register bot with spending limits
  3. Fund vault with Aave test USDC (mint from Aave faucet)

Usage:
    pip install -r requirements.txt
    cp .env.example .env
    python lend.py supply          # supply USDC to Aave
    python lend.py withdraw        # withdraw USDC from Aave
    python lend.py balance         # check vault balances
"""

import asyncio
import os
import sys

from dotenv import load_dotenv
from web3 import Web3

from axonfi import AxonClient, Chain

load_dotenv()

# ── Axon client ─────────────────────────────────────────────────────────────

axon = AxonClient(
    vault_address=os.environ["AXON_VAULT_ADDRESS"],
    chain_id=int(os.environ.get("AXON_CHAIN_ID", str(Chain.BaseSepolia))),
    bot_private_key=os.environ["AXON_BOT_PRIVATE_KEY"],
)

# ── Aave V3 addresses (Base Sepolia) ────────────────────────────────────────
# Note: Aave uses its OWN test USDC, not Circle's USDC (0x036CbD53...).
# This is common in DeFi testnets — protocols deploy their own test tokens.

AAVE_POOL = "0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27"
AAVE_USDC = "0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f"  # Aave's test USDC (6 decimals)
AAVE_aUSDC = "0x10F1A9D11CDf50041f3f8cB7191CBE2f31750ACC"  # aToken receipt

USDC_DECIMALS = 6
SUPPLY_AMOUNT = float(os.environ.get("SUPPLY_AMOUNT", "100"))  # 100 USDC default

# ── ABI fragments ───────────────────────────────────────────────────────────

SUPPLY_ABI = [{
    "name": "supply",
    "type": "function",
    "stateMutability": "nonpayable",
    "inputs": [
        {"name": "asset", "type": "address"},
        {"name": "amount", "type": "uint256"},
        {"name": "onBehalfOf", "type": "address"},
        {"name": "referralCode", "type": "uint16"},
    ],
    "outputs": [],
}]

WITHDRAW_ABI = [{
    "name": "withdraw",
    "type": "function",
    "stateMutability": "nonpayable",
    "inputs": [
        {"name": "asset", "type": "address"},
        {"name": "amount", "type": "uint256"},
        {"name": "to", "type": "address"},
    ],
    "outputs": [{"type": "uint256"}],
}]

w3 = Web3()

# ── Helpers ─────────────────────────────────────────────────────────────────


def to_base_units(amount: float) -> int:
    return int(amount * 10**USDC_DECIMALS)


def from_base_units(amount: int) -> str:
    return f"{amount / 10**USDC_DECIMALS:.2f}"


def encode_supply(asset: str, amount: int, on_behalf_of: str) -> str:
    contract = w3.eth.contract(abi=SUPPLY_ABI)
    return contract.encode_abi(
        "supply",
        [Web3.to_checksum_address(asset), amount, Web3.to_checksum_address(on_behalf_of), 0],
    )


def encode_withdraw(asset: str, amount: int, to: str) -> str:
    contract = w3.eth.contract(abi=WITHDRAW_ABI)
    return contract.encode_abi(
        "withdraw",
        [Web3.to_checksum_address(asset), amount, Web3.to_checksum_address(to)],
    )


async def wait_for_result(request_id: str, label: str = ""):
    """Poll until terminal state (approved/rejected), max 60s."""
    result = None
    for _ in range(30):
        result = await axon.poll_execute(request_id)
        if result.status in ("approved", "rejected"):
            return result
        print(f"  {label}status: {result.status}...")
        await asyncio.sleep(2)
    return result


def print_result(result):
    print(f"  Status: {result.status}")
    if result.tx_hash:
        print(f"  TX: https://sepolia.basescan.org/tx/{result.tx_hash}")
    if result.reason:
        print(f"  Reason: {result.reason}")


# ── Commands ────────────────────────────────────────────────────────────────

async def cmd_supply():
    amount = to_base_units(SUPPLY_AMOUNT)
    print(f"\nSupplying {SUPPLY_AMOUNT} USDC to Aave V3...")

    # Encode: pool.supply(AAVE_USDC, amount, vault, 0)
    # The vault supplies on its own behalf — aTokens accrue in the vault.
    call_data = encode_supply(AAVE_USDC, amount, axon.vault_address)

    # execute() handles: approve USDC → call pool.supply() → revoke
    # We pass the raw token address since Aave USDC isn't in Axon's known tokens.
    result = await axon.execute(
        protocol=AAVE_POOL,
        call_data=call_data,
        token=AAVE_USDC,       # raw address — not a known symbol
        amount=amount,          # raw base units (int)
        protocol_name="Aave V3 Supply",
        memo=f"Supply {SUPPLY_AMOUNT} USDC to Aave",
    )

    if result.request_id and not result.tx_hash:
        result = await wait_for_result(result.request_id, "supply ")
    print_result(result)


async def cmd_withdraw():
    amount = to_base_units(SUPPLY_AMOUNT)
    print(f"\nWithdrawing {SUPPLY_AMOUNT} USDC from Aave V3...")

    # Encode: pool.withdraw(AAVE_USDC, amount, vault)
    # Withdraws to the vault itself — funds return to vault custody.
    call_data = encode_withdraw(AAVE_USDC, amount, axon.vault_address)

    # For withdraw, no token approval is needed — Aave Pool burns aTokens
    # internally. When amount=0, the vault skips the approve → revoke cycle
    # and just calls the protocol directly. This is the pattern for any
    # protocol call that doesn't need the vault to approve token spending.
    result = await axon.execute(
        protocol=AAVE_POOL,
        call_data=call_data,
        token=AAVE_USDC,       # required field, but amount=0 means no approval
        amount=0,              # 0 = skip approve/revoke, just call the protocol
        protocol_name="Aave V3 Withdraw",
        memo=f"Withdraw {SUPPLY_AMOUNT} USDC from Aave",
    )

    if result.request_id and not result.tx_hash:
        result = await wait_for_result(result.request_id, "withdraw ")
    print_result(result)


async def cmd_balance():
    usdc = await axon.get_balance(AAVE_USDC)
    a_usdc = await axon.get_balance(AAVE_aUSDC)

    print(f"\nVault balances:")
    print(f"  USDC (Aave):  {from_base_units(usdc)}")
    print(f"  aUSDC:        {from_base_units(a_usdc)} (earning yield)")


# ── CLI ─────────────────────────────────────────────────────────────────────

USAGE = """
Aave V3 Lending — supply/withdraw USDC via Axon vault

Commands:
  supply      Supply USDC to Aave (earn yield)
  withdraw    Withdraw USDC from Aave
  balance     Show vault USDC + aUSDC balances
  help        Show this message

Examples:
  python lend.py supply
  python lend.py withdraw
  SUPPLY_AMOUNT=500 python lend.py supply
"""


async def main():
    if len(sys.argv) < 2 or sys.argv[1].lower() == "help":
        print(USAGE)
        return

    cmd = sys.argv[1].lower()
    print(f"Vault: {axon.vault_address}")
    print(f"Bot:   {axon.bot_address}")
    print(f"Chain: Base Sepolia")

    if cmd == "supply":
        await cmd_supply()
    elif cmd == "withdraw":
        await cmd_withdraw()
    elif cmd == "balance":
        await cmd_balance()
    else:
        print(f"Unknown command: {cmd}")
        print(USAGE)

    await axon.close()


if __name__ == "__main__":
    asyncio.run(main())
