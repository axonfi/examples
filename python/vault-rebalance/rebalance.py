"""Vault rebalance — swap tokens inside the vault without sending to anyone.

Demonstrates Axon's executeSwap() endpoint. The bot signs a SwapIntent
specifying fromToken, maxFromAmount, toToken, and minToAmount. The relayer
gets a Uniswap quote, verifies it's within bounds, and executes on-chain.

Usage:
    pip install -r requirements.txt
    cp .env.example .env
    python rebalance.py                     # swap up to 1 USDC -> WETH
    python rebalance.py 5                   # swap up to 5 USDC -> WETH
    python rebalance.py balance             # check vault balances
"""

import asyncio
import os
import sys

from dotenv import load_dotenv

from axonfi import AxonClient, Chain

load_dotenv()

# Base Sepolia token addresses
USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
WETH = "0x4200000000000000000000000000000000000006"


async def cmd_rebalance(client: AxonClient, max_usdc: float):
    print(f"\nSwapping up to {max_usdc} USDC -> WETH (in-vault rebalance)")
    print("  fromToken:     USDC (bot-signed — relayer cannot change this)")
    print(f"  maxFromAmount: {max_usdc} USDC (bot-signed — caps input cost)")
    print("  toToken:       WETH")
    # Calculate a reasonable minToAmount based on ~$2000/ETH with 10% slippage
    estimated_eth_per_usdc = 1 / 2200  # conservative
    min_weth = max_usdc * estimated_eth_per_usdc * 0.9
    min_weth_wei = int(min_weth * 1e18)
    print(f"  minToAmount:   {min_weth:.8f} WETH ({min_weth_wei} wei)\n")

    result = await client.swap(
        to_token="WETH",
        min_to_amount=min_weth_wei,
        from_token="USDC",
        max_from_amount=max_usdc,
        memo=f"Rebalance: up to {max_usdc} USDC -> WETH",
    )

    # Poll if AI scan triggered
    if result.request_id and not result.tx_hash:
        for _ in range(30):
            result = await client.poll_swap(result.request_id)
            if result.status in ("approved", "rejected"):
                break
            print(f"  status: {result.status}...")
            await asyncio.sleep(2)

    print(f"  Status: {result.status}")
    if result.tx_hash:
        print(f"  TX: https://sepolia.basescan.org/tx/{result.tx_hash}")
    if result.reason:
        print(f"  Reason: {result.reason}")


async def cmd_balance(client: AxonClient):
    usdc_bal = await client.get_balance(USDC)
    weth_bal = await client.get_balance(WETH)
    print("\nVault balances:")
    print(f"  USDC:  {int(usdc_bal) / 1e6:.6f}")
    print(f"  WETH:  {int(weth_bal) / 1e18:.18f}")


async def main():
    client = AxonClient(
        vault_address=os.environ["AXON_VAULT_ADDRESS"],
        chain_id=int(os.environ.get("AXON_CHAIN_ID", str(Chain.BaseSepolia))),
        bot_private_key=os.environ["AXON_BOT_PRIVATE_KEY"],
    )

    cmd = sys.argv[1] if len(sys.argv) > 1 else "1"

    if cmd == "help":
        print(__doc__)
        return

    if cmd == "balance":
        print(f"Vault: {client.vault_address}")
        await cmd_balance(client)
        return

    print(f"Vault: {client.vault_address}")
    print(f"Bot:   {client.bot_address}")
    print("Chain: Base Sepolia")

    amount = float(cmd)
    await cmd_balance(client)
    await cmd_rebalance(client, amount)
    await cmd_balance(client)


if __name__ == "__main__":
    asyncio.run(main())
