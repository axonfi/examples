"""Swap-and-pay — Pay in any token, even if the vault doesn't hold it.

Demonstrates Axon's automatic swap routing. The bot requests a payment
in USDC, but the vault only has WETH. The relayer detects this, finds a
Uniswap route (WETH -> USDC), swaps the exact amount needed, and sends
the payment — all in a single transaction. The bot doesn't need to know
which tokens the vault holds.

This is a core Axon feature: bots always pay in the token the recipient
expects. The vault's internal token mix is the owner's concern, not the bot's.

Setup:
  1. Deploy vault on Base Sepolia, register bot
  2. Fund vault with WETH (NOT USDC) — this forces the swap route
  3. Set bot maxPerTxAmount high enough (or 0 for no cap)

Usage:
    pip install -r requirements.txt
    cp .env.example .env
    python pay.py                  # pay 0.01 USDC (default)
    python pay.py 5                # pay 5 USDC
    python pay.py balance          # check vault WETH + USDC balances
"""

import asyncio
import os
import sys

from dotenv import load_dotenv

from axonfi import AxonClient, Chain

load_dotenv()

# ── Axon client ─────────────────────────────────────────────────────────────

axon = AxonClient(
    vault_address=os.environ["AXON_VAULT_ADDRESS"],
    chain_id=int(os.environ.get("AXON_CHAIN_ID", str(Chain.BaseSepolia))),
    bot_private_key=os.environ["AXON_BOT_PRIVATE_KEY"],
)

RECIPIENT = os.environ.get("RECIPIENT")
if not RECIPIENT:
    print("Set RECIPIENT in .env (address to receive payment)")
    sys.exit(1)

# Circle USDC on Base Sepolia
USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
# Wrapped ETH on Base Sepolia
WETH = "0x4200000000000000000000000000000000000006"

# ── Commands ────────────────────────────────────────────────────────────────


async def cmd_pay(amount_usdc: float):
    print(f"\nPaying {amount_usdc} USDC to {RECIPIENT[:10]}...")
    print(f"  (vault may not hold USDC — relayer will swap WETH -> USDC if needed)")

    # The bot just says "pay X USDC". If the vault has USDC, it sends directly.
    # If the vault only has WETH, the relayer automatically:
    #   1. Gets a Uniswap quote (WETH -> USDC)
    #   2. Builds swap calldata
    #   3. Calls executePayment() with the swap params
    #   4. The vault swaps WETH -> USDC and sends USDC to the recipient
    result = await axon.pay(
        to=RECIPIENT,
        token="USDC",
        amount=amount_usdc,
        memo=f"Swap-and-pay example: {amount_usdc} USDC",
    )

    # If payment triggers AI scan, poll for result
    if result.request_id and not result.tx_hash:
        for _ in range(30):
            result = await axon.poll(result.request_id)
            if result.status in ("approved", "rejected"):
                break
            print(f"  status: {result.status}...")
            await asyncio.sleep(2)

    print(f"  Status: {result.status}")
    if result.tx_hash:
        print(f"  TX: https://sepolia.basescan.org/tx/{result.tx_hash}")
    if result.reason:
        print(f"  Reason: {result.reason}")


async def cmd_balance():
    usdc_bal = await axon.get_balance(USDC)
    weth_bal = await axon.get_balance(WETH)

    print(f"\nVault balances:")
    print(f"  USDC:  {usdc_bal / 1e6:.2f}")
    print(f"  WETH:  {weth_bal / 1e18:.6f}")


# ── CLI ─────────────────────────────────────────────────────────────────────

USAGE = """
Swap-and-pay — pay in USDC even when vault only has WETH

Usage:
  python pay.py                  Pay 0.01 USDC (default)
  python pay.py 5                Pay 5 USDC
  python pay.py balance          Show vault balances
  python pay.py help             Show this message
"""


async def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "0.01"

    if cmd == "help":
        print(USAGE)
        return
    if cmd == "balance":
        print(f"Vault: {axon.vault_address}")
        await cmd_balance()
        await axon.close()
        return

    print(f"Vault: {axon.vault_address}")
    print(f"Bot:   {axon.bot_address}")
    print(f"Chain: Base Sepolia")

    try:
        amount = float(cmd)
    except ValueError:
        print(f"Unknown command: {cmd}")
        print(USAGE)
        return

    await cmd_pay(amount)
    await cmd_balance()
    await axon.close()


if __name__ == "__main__":
    asyncio.run(main())
