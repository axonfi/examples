"""DeFi trading agent — swaps USDC to WETH when ETH price dips.

Demonstrates AxonClient.swap() for in-vault rebalancing.

Usage:
    pip install -r requirements.txt
    cp .env.example .env
    python agent.py
"""

import asyncio
import os

import httpx
from dotenv import load_dotenv

from axonfi import AxonClient, Chain

load_dotenv()

# Configuration
BUY_BELOW_USD = 2000.0  # Buy WETH when ETH drops below this
SWAP_AMOUNT_USDC = 10.0  # Swap 10 USDC worth
POLL_INTERVAL = 30  # Check every 30 seconds


async def get_eth_price() -> float:
    """Fetch ETH/USD price from CoinGecko."""
    async with httpx.AsyncClient() as http:
        resp = await http.get(
            "https://api.coingecko.com/api/v3/simple/price",
            params={"ids": "ethereum", "vs_currencies": "usd"},
        )
        resp.raise_for_status()
        return resp.json()["ethereum"]["usd"]


async def main():
    client = AxonClient(
        vault_address=os.environ["AXON_VAULT_ADDRESS"],
        chain_id=int(os.environ.get("AXON_CHAIN_ID", str(Chain.BaseSepolia))),
        bot_private_key=os.environ["AXON_BOT_PRIVATE_KEY"],
    )

    print(f"DeFi Trading Agent")
    print(f"Bot: {client.bot_address}")
    print(f"Strategy: Buy WETH when ETH < ${BUY_BELOW_USD}")
    print(f"Swap size: {SWAP_AMOUNT_USDC} USDC per trigger")
    print()

    while True:
        try:
            price = await get_eth_price()
            print(f"ETH: ${price:.2f}", end="")

            if price < BUY_BELOW_USD:
                print(f" < ${BUY_BELOW_USD} — swapping {SWAP_AMOUNT_USDC} USDC → WETH")
                # Calculate minimum WETH output (5% slippage tolerance)
                min_weth = (SWAP_AMOUNT_USDC / price) * 0.95
                result = await client.swap(
                    to_token="WETH",
                    min_to_amount=min_weth,
                    from_token="USDC",
                    max_from_amount=SWAP_AMOUNT_USDC,
                    memo=f"DCA buy: ETH at ${price:.2f}",
                )
                print(f"  Result: {result.status}", end="")
                if result.tx_hash:
                    print(f" TX: {result.tx_hash}")
                elif result.reason:
                    print(f" Reason: {result.reason}")
                else:
                    print()
            else:
                print(f" — holding")

        except Exception as e:
            print(f" Error: {e}")

        await asyncio.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    asyncio.run(main())
