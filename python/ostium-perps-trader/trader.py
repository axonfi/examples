"""Ostium perpetuals trader — trade BTC, ETH, forex, commodities, and stocks with Axon treasury.

Uses the Axon vault as treasury and the Ostium SDK for leveraged perpetual trading
on Arbitrum Sepolia. The bot draws USDC from the vault when needed and trades via Ostium.

Usage:
    pip install -r requirements.txt
    cp .env.example .env
    python trader.py
"""

import asyncio
import json
import os
import sys

from dotenv import load_dotenv

load_dotenv()


# ── Axon client (treasury) ──────────────────────────────────────────────────

def _load_bot_key() -> str:
    """Load bot private key from env (raw hex) or keystore file + passphrase."""
    raw_key = os.environ.get("AXON_BOT_PRIVATE_KEY")
    if raw_key:
        return raw_key

    keystore_path = os.environ.get("AXON_BOT_KEYSTORE_PATH")
    passphrase = os.environ.get("AXON_BOT_PASSPHRASE")
    if keystore_path and passphrase:
        from eth_account import Account

        with open(keystore_path) as f:
            keystore = json.load(f)
        return "0x" + Account.decrypt(keystore, passphrase).hex()

    print("Error: set AXON_BOT_PRIVATE_KEY or AXON_BOT_KEYSTORE_PATH + AXON_BOT_PASSPHRASE", file=sys.stderr)
    sys.exit(1)


from axonfi import AxonClient, Chain

axon = AxonClient(
    vault_address=os.environ["AXON_VAULT_ADDRESS"],
    chain_id=int(os.environ.get("AXON_CHAIN_ID", str(Chain.ArbitrumSepolia))),
    bot_private_key=_load_bot_key(),
)


# ── Ostium SDK (trading) ────────────────────────────────────────────────────

from ostium_python_sdk import OstiumSDK, NetworkConfig

OSTIUM_USDC = "0xe73B11Fb1e3eeEe8AF2a23079A4410Fe1B370548"  # Ostium testnet USDC

ostium_config = NetworkConfig.testnet()
ostium = OstiumSDK(
    ostium_config,
    private_key=os.environ["OSTIUM_TRADER_KEY"],
    rpc_url=os.environ["RPC_URL"],
    verbose=False,
)

TRADER_ADDRESS = ostium.ostium.get_public_address()

# ── Configuration ────────────────────────────────────────────────────────────

# Pairs: 0=BTC, 1=ETH, 2=EUR/USD, 5=XAU/USD, 7=CL/USD (oil), 9=SOL, 10=SPX
PAIR_ID = int(os.environ.get("PAIR_ID", "0"))  # BTC by default
PAIR_NAMES = {
    0: "BTC/USD", 1: "ETH/USD", 2: "EUR/USD", 3: "GBP/USD", 4: "USD/JPY",
    5: "XAU/USD", 6: "HG/USD", 7: "CL/USD", 8: "XAG/USD", 9: "SOL/USD",
    10: "SPX", 11: "DJI", 12: "NDX", 18: "NVDA", 22: "TSLA",
}
PAIR_BASES = {
    0: "BTC", 1: "ETH", 2: "EUR", 3: "GBP", 4: "USD",
    5: "XAU", 6: "HG", 7: "CL", 8: "XAG", 9: "SOL",
    10: "SPX", 11: "DJI", 12: "NDX", 18: "NVDA", 22: "TSLA",
}
PAIR_QUOTES = {
    0: "USD", 1: "USD", 2: "USD", 3: "USD", 4: "JPY",
    5: "USD", 6: "USD", 7: "USD", 8: "USD", 9: "USD",
    10: "USD", 11: "USD", 12: "USD", 18: "USD", 22: "USD",
}

COLLATERAL_USDC = float(os.environ.get("COLLATERAL_USDC", "50"))
LEVERAGE = float(os.environ.get("LEVERAGE", "5"))
DIRECTION = os.environ.get("DIRECTION", "long").lower() == "long"
FUNDING_BUFFER_USDC = float(os.environ.get("FUNDING_BUFFER_USDC", "10"))


# ── Helpers ──────────────────────────────────────────────────────────────────

async def get_trader_usdc_balance() -> float:
    """Check USDC balance of the Ostium trading wallet."""
    from web3 import Web3

    w3 = Web3(Web3.HTTPProvider(os.environ["RPC_URL"]))
    usdc_abi = [{"inputs": [{"name": "account", "type": "address"}], "name": "balanceOf", "outputs": [{"name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"}]
    usdc = w3.eth.contract(address=OSTIUM_USDC, abi=usdc_abi)
    raw = usdc.functions.balanceOf(TRADER_ADDRESS).call()
    return raw / 1e6


async def fund_trader_from_vault(amount_usdc: float):
    """Transfer USDC from Axon vault to the Ostium trading wallet."""
    print(f"  Funding trader: {amount_usdc} USDC from vault → {TRADER_ADDRESS[:10]}...")
    result = await axon.pay(
        to=TRADER_ADDRESS,
        token=OSTIUM_USDC,
        amount=amount_usdc,
        memo=f"Fund Ostium trader for {PAIR_NAMES.get(PAIR_ID, f'pair {PAIR_ID}')} trade",
    )
    if result.status == "approved":
        print(f"  Funded! TX: {result.tx_hash}")
        return True
    else:
        print(f"  Funding failed: {result.reason}")
        return False


async def ensure_trader_funded(needed_usdc: float) -> bool:
    """Top up the trading wallet from the vault if balance is insufficient."""
    balance = await get_trader_usdc_balance()
    print(f"  Trader USDC balance: {balance:.2f}")

    if balance >= needed_usdc:
        return True

    shortfall = needed_usdc - balance + FUNDING_BUFFER_USDC
    print(f"  Need {needed_usdc:.2f} USDC, have {balance:.2f} — funding {shortfall:.2f} from vault")
    return await fund_trader_from_vault(shortfall)


# ── Trading ──────────────────────────────────────────────────────────────────

async def open_position():
    """Open a leveraged position on Ostium, funded from the Axon vault."""
    pair_name = PAIR_NAMES.get(PAIR_ID, f"Pair {PAIR_ID}")
    direction = "Long" if DIRECTION else "Short"
    base = PAIR_BASES.get(PAIR_ID, "BTC")
    quote = PAIR_QUOTES.get(PAIR_ID, "USD")

    print(f"\nOpening {direction} {pair_name}")
    print(f"  Collateral: {COLLATERAL_USDC} USDC | Leverage: {LEVERAGE}x")
    print(f"  Notional: ~${COLLATERAL_USDC * LEVERAGE:.0f}")

    # 1. Ensure the trading wallet has enough USDC
    if not await ensure_trader_funded(COLLATERAL_USDC):
        print("  Aborting — could not fund trader")
        return None

    # 2. Get latest price from Ostium
    price, _, _ = await ostium.price.get_price(base, quote)
    print(f"  {pair_name} price: ${price:,.2f}")

    # 3. Open the trade via Ostium SDK
    trade_params = {
        "collateral": COLLATERAL_USDC,
        "leverage": LEVERAGE,
        "asset_type": PAIR_ID,
        "direction": DIRECTION,
        "order_type": "MARKET",
    }

    try:
        result = ostium.ostium.perform_trade(trade_params, at_price=price)
        tx_hash = result["receipt"]["transactionHash"].hex()
        order_id = result.get("order_id")
        print(f"  Trade opened! TX: {tx_hash}")
        if order_id is not None:
            print(f"  Order ID: {order_id}")
        return result
    except Exception as e:
        print(f"  Trade failed: {e}")
        return None


async def show_positions():
    """Display open positions on Ostium."""
    trades = await ostium.subgraph.get_open_trades(TRADER_ADDRESS)
    if not trades:
        print("\nNo open positions")
        return

    print(f"\nOpen positions ({len(trades)}):")
    for trade in trades:
        from ostium_python_sdk.utils import get_trade_details

        open_price, notional, time, leverage, collateral, pair_idx, index, is_long, sl, tp = get_trade_details(trade)
        pair_name = PAIR_NAMES.get(int(pair_idx), f"Pair {pair_idx}")
        direction = "Long" if is_long else "Short"
        print(f"  [{pair_idx}:{index}] {direction} {pair_name} | {collateral} USDC @ {leverage}x | Entry: ${open_price:,.2f}")
        if float(tp) > 0:
            print(f"         TP: ${float(tp):,.2f} | SL: ${float(sl):,.2f}")


async def close_position(pair_id: int, trade_index: int):
    """Close an open position on Ostium."""
    print(f"\nClosing position {pair_id}:{trade_index}...")
    try:
        receipt = ostium.ostium.close_trade(pair_id, trade_index)
        tx_hash = receipt["transactionHash"].hex()
        print(f"  Closed! TX: {tx_hash}")
    except Exception as e:
        print(f"  Close failed: {e}")


# ── CLI ──────────────────────────────────────────────────────────────────────

USAGE = """
Ostium Perps Trader — powered by Axon vault treasury

Commands:
  open              Open a position (uses env config)
  positions         Show open positions
  close <pair> <i>  Close position by pair ID and trade index
  price             Show current price for configured pair
  balance           Show vault + trader USDC balances
  fund <amount>     Fund trader wallet from vault
  help              Show this message

Examples:
  python trader.py open
  python trader.py positions
  python trader.py close 0 0
  python trader.py fund 100
"""


async def main():
    if len(sys.argv) < 2:
        print(USAGE)
        return

    cmd = sys.argv[1].lower()

    pair_name = PAIR_NAMES.get(PAIR_ID, f"Pair {PAIR_ID}")
    print(f"Axon vault:  {axon.vault_address}")
    print(f"Axon bot:    {axon.bot_address}")
    print(f"Ostium trader: {TRADER_ADDRESS}")
    print(f"Pair: {pair_name} | Chain: Arbitrum Sepolia")

    if cmd == "open":
        await open_position()

    elif cmd == "positions":
        await show_positions()

    elif cmd == "close":
        if len(sys.argv) < 4:
            print("Usage: python trader.py close <pair_id> <trade_index>")
            return
        await close_position(int(sys.argv[2]), int(sys.argv[3]))

    elif cmd == "price":
        base = PAIR_BASES.get(PAIR_ID, "BTC")
        quote = PAIR_QUOTES.get(PAIR_ID, "USD")
        price, _, _ = await ostium.price.get_price(base, quote)
        print(f"\n{pair_name}: ${price:,.2f}")

    elif cmd == "balance":
        vault_bal = await axon.get_balance(OSTIUM_USDC)
        trader_bal = await get_trader_usdc_balance()
        print(f"\n  Vault USDC:  {vault_bal / 1e6:.2f}")
        print(f"  Trader USDC: {trader_bal:.2f}")

    elif cmd == "fund":
        if len(sys.argv) < 3:
            print("Usage: python trader.py fund <amount_usdc>")
            return
        await fund_trader_from_vault(float(sys.argv[2]))

    elif cmd == "help":
        print(USAGE)

    else:
        print(f"Unknown command: {cmd}")
        print(USAGE)


if __name__ == "__main__":
    asyncio.run(main())
