"""Ostium perpetuals trader — vault-as-trader pattern.

The Axon vault IS the trader on Ostium. It approves USDC to Ostium's
TradingStorage contract, then calls openTrade with trader=vault.
Positions and gains belong to the vault, under owner control.

Setup (one-time):
  1. Deploy vault on Arbitrum Sepolia
  2. Register bot, add Ostium Trading + Ostium USDC as approved protocols
  3. Set bot maxPerTxAmount=0 (Ostium USDC has no Uniswap pool for oracle)
  4. Fund vault with Ostium testnet USDC

Usage:
    pip install -r requirements.txt
    cp .env.example .env
    python trader.py open
    python trader.py price
"""

import asyncio
import os
import sys

from decimal import Decimal
from dotenv import load_dotenv
from web3 import Web3

from axonfi import AxonClient, Chain

load_dotenv()

# ── Axon client ──────────────────────────────────────────────────────────────

axon = AxonClient(
    vault_address=os.environ["AXON_VAULT_ADDRESS"],
    chain_id=int(os.environ.get("AXON_CHAIN_ID", str(Chain.ArbitrumSepolia))),
    bot_private_key=os.environ["AXON_BOT_PRIVATE_KEY"],
)

# ── Ostium addresses (Arb Sepolia) ──────────────────────────────────────────

OSTIUM_TRADING = "0x2A9B9c988393f46a2537B0ff11E98c2C15a95afe"
OSTIUM_TRADING_STORAGE = "0x0b9F5243B29938668c9Cfbd7557A389EC7Ef88b8"
OSTIUM_USDC = "0xe73B11Fb1e3eeEe8AF2a23079A4410Fe1B370548"

# ── Trade config ─────────────────────────────────────────────────────────────

PAIR_ID = int(os.environ.get("PAIR_ID", "0"))
COLLATERAL_USDC = float(os.environ.get("COLLATERAL_USDC", "50"))
LEVERAGE = float(os.environ.get("LEVERAGE", "5"))
DIRECTION = os.environ.get("DIRECTION", "long").lower() == "long"

PAIR_NAMES = {
    0: "BTC/USD", 1: "ETH/USD", 2: "EUR/USD", 3: "GBP/USD", 4: "USD/JPY",
    5: "XAU/USD", 6: "HG/USD", 7: "CL/USD", 8: "XAG/USD", 9: "SOL/USD",
    10: "SPX", 11: "DJI", 12: "NDX", 18: "NVDA", 22: "TSLA",
}
PAIR_BASES = {
    0: "BTC", 1: "ETH", 2: "EUR", 3: "GBP", 4: "USD",
    5: "XAU", 6: "HG", 7: "CL", 8: "XAG", 9: "SOL",
}


# ── Encoding helpers ─────────────────────────────────────────────────────────

def to_base_units(amount, decimals=6):
    return int(float(amount) * 10**decimals)


def convert_to_scaled_integer(value, precision=5, scale=18):
    precise_value = round(Decimal(str(value)) * (10 ** precision))
    return int(precise_value * (10 ** (scale - precision)))


def encode_approve(spender: str, amount: int) -> str:
    w3 = Web3()
    abi = [{"inputs": [{"name": "spender", "type": "address"}, {"name": "amount", "type": "uint256"}],
            "name": "approve", "outputs": [{"type": "bool"}], "stateMutability": "nonpayable", "type": "function"}]
    contract = w3.eth.contract(abi=abi)
    return contract.encode_abi("approve", [Web3.to_checksum_address(spender), amount])


def encode_close_trade(pair_id: int, trade_index: int, close_pct: int, price: float) -> str:
    abi = [{
        "inputs": [
            {"name": "pairIndex", "type": "uint16"},
            {"name": "index", "type": "uint8"},
            {"name": "closePercentage", "type": "uint16"},
            {"name": "marketPrice", "type": "uint192"},
            {"name": "slippageP", "type": "uint32"},
        ],
        "name": "closeTradeMarket", "outputs": [], "stateMutability": "nonpayable", "type": "function",
    }]
    w3 = Web3()
    contract = w3.eth.contract(abi=abi)
    market_price = convert_to_scaled_integer(price)
    slippage = int(2 * 100)  # 2%
    return contract.encode_abi("closeTradeMarket", [pair_id, trade_index, close_pct * 100, market_price, slippage])


def encode_open_trade(vault_address: str, price: float) -> str:
    abi = [{
        "inputs": [
            {"components": [
                {"name": "collateral", "type": "uint256"},
                {"name": "openPrice", "type": "uint192"},
                {"name": "tp", "type": "uint192"},
                {"name": "sl", "type": "uint192"},
                {"name": "trader", "type": "address"},
                {"name": "leverage", "type": "uint32"},
                {"name": "pairIndex", "type": "uint16"},
                {"name": "index", "type": "uint8"},
                {"name": "buy", "type": "bool"},
            ], "name": "t", "type": "tuple"},
            {"components": [
                {"name": "builder", "type": "address"},
                {"name": "builderFee", "type": "uint32"},
            ], "name": "bf", "type": "tuple"},
            {"name": "orderType", "type": "uint8"},
            {"name": "slippageP", "type": "uint256"},
        ],
        "name": "openTrade", "outputs": [], "stateMutability": "nonpayable", "type": "function",
    }]

    w3 = Web3()
    contract = w3.eth.contract(abi=abi)

    trade = (
        convert_to_scaled_integer(COLLATERAL_USDC, precision=5, scale=6),
        convert_to_scaled_integer(price),
        0, 0,  # no TP/SL
        Web3.to_checksum_address(vault_address),
        to_base_units(LEVERAGE, decimals=2),
        PAIR_ID, 0, DIRECTION,
    )
    builder_fee = ("0x0000000000000000000000000000000000000000", 0)
    slippage = int(2 * 100)  # 2%

    return contract.encode_abi("openTrade", [trade, builder_fee, 0, slippage])


# ── Ostium price ─────────────────────────────────────────────────────────────

async def get_price() -> float:
    from ostium_python_sdk import OstiumSDK, NetworkConfig
    config = NetworkConfig.testnet()
    rpc = os.environ.get("RPC_URL", "https://arb-sepolia.g.alchemy.com/v2/demo")
    sdk = OstiumSDK(config, None, rpc)
    base = PAIR_BASES.get(PAIR_ID, "BTC")
    price, _, _ = await sdk.price.get_price(base, "USD")
    return price


# ── Commands ─────────────────────────────────────────────────────────────────

async def wait_for_result(request_id: str, label: str = "") -> "PaymentResult":
    """Poll until terminal state (approved/rejected), max 60s."""
    for i in range(30):
        result = await axon.poll_execute(request_id)
        if result.status in ("approved", "rejected"):
            return result
        print(f"  {label}status: {result.status}..." if label else f"  status: {result.status}...")
        await asyncio.sleep(2)
    return result


async def cmd_open():
    pair_name = PAIR_NAMES.get(PAIR_ID, f"Pair {PAIR_ID}")
    direction = "Long" if DIRECTION else "Short"

    print(f"\nOpening {direction} {pair_name}")
    print(f"  Collateral: {COLLATERAL_USDC} USDC | Leverage: {LEVERAGE}x")
    print(f"  Notional: ~${COLLATERAL_USDC * LEVERAGE:.0f}")

    # Step 1: Ensure persistent USDC approval to TradingStorage
    print("\n  Approving USDC to TradingStorage...")
    approve_calldata = encode_approve(OSTIUM_TRADING_STORAGE, 1_000_000 * 10**6)
    result = await axon.execute(
        protocol=OSTIUM_USDC,
        call_data=approve_calldata,
        token=OSTIUM_USDC,
        amount=0,
        protocol_name="Ostium USDC Approve",
    )
    if result.request_id and not result.tx_hash:
        result = await wait_for_result(result.request_id, "approve ")
    if result.reason:
        print(f"  Approval failed: {result.reason}")
        return
    print(f"  Approved! TX: {result.tx_hash}")

    # Step 2: Get price
    price = await get_price()
    print(f"\n  {pair_name} price: ${price:,.2f}")

    # Step 3: Open trade (vault is the trader)
    collateral_raw = int(COLLATERAL_USDC * 1_000_000)
    calldata = encode_open_trade(axon.vault_address, price)
    print(f"  Opening trade...")
    result = await axon.execute(
        protocol=OSTIUM_TRADING,
        call_data=calldata,
        token=OSTIUM_USDC,
        amount=collateral_raw,
        protocol_name="Ostium",
    )
    if result.request_id and not result.tx_hash:
        result = await wait_for_result(result.request_id, "trade ")

    if result.tx_hash:
        print(f"  Trade opened! TX: {result.tx_hash}")
    elif result.reason:
        print(f"  Trade failed: {result.reason}")


async def cmd_close():
    pair_id = PAIR_ID
    trade_index = int(os.environ.get("TRADE_INDEX", "0"))
    close_pct = int(os.environ.get("CLOSE_PCT", "100"))  # 100 = full close
    pair_name = PAIR_NAMES.get(pair_id, f"Pair {pair_id}")

    print(f"\nClosing {'all' if close_pct == 100 else f'{close_pct}%'} of {pair_name} trade #{trade_index}")

    # Get current price for slippage
    price = await get_price()
    print(f"  {pair_name} price: ${price:,.2f}")

    calldata = encode_close_trade(pair_id, trade_index, close_pct, price)
    print(f"  Submitting close...")
    result = await axon.execute(
        protocol=OSTIUM_TRADING,
        call_data=calldata,
        token=OSTIUM_USDC,
        amount=0,
        protocol_name="Ostium Close",
    )
    if result.request_id and not result.tx_hash:
        result = await wait_for_result(result.request_id, "close ")

    if result.tx_hash:
        print(f"  Trade closed! TX: {result.tx_hash}")
    elif result.reason:
        print(f"  Close failed: {result.reason}")


async def cmd_price():
    pair_name = PAIR_NAMES.get(PAIR_ID, f"Pair {PAIR_ID}")
    price = await get_price()
    print(f"\n{pair_name}: ${price:,.2f}")


async def cmd_balance():
    bal = await axon.get_balance(OSTIUM_USDC)
    print(f"\nVault USDC: {bal / 1e6:.2f}")


# ── CLI ──────────────────────────────────────────────────────────────────────

USAGE = """
Ostium Perps Trader — vault-as-trader via Axon

Commands:
  open      Open a position (uses env config)
  close     Close a position (PAIR_ID + TRADE_INDEX)
  price     Show current price for configured pair
  balance   Show vault USDC balance
  help      Show this message

Examples:
  python trader.py open
  python trader.py close                              # close PAIR_ID=0, index=0, 100%
  TRADE_INDEX=1 python trader.py close                # close trade index 1
  CLOSE_PCT=50 python trader.py close                 # close 50% of position
  PAIR_ID=1 LEVERAGE=10 DIRECTION=short python trader.py open
"""


async def main():
    if len(sys.argv) < 2:
        print(USAGE)
        return

    cmd = sys.argv[1].lower()
    pair_name = PAIR_NAMES.get(PAIR_ID, f"Pair {PAIR_ID}")
    print(f"Vault: {axon.vault_address}")
    print(f"Bot:   {axon.bot_address}")
    print(f"Pair:  {pair_name} | Chain: Arbitrum Sepolia")

    if cmd == "open":
        await cmd_open()
    elif cmd == "close":
        await cmd_close()
    elif cmd == "price":
        await cmd_price()
    elif cmd == "balance":
        await cmd_balance()
    elif cmd == "help":
        print(USAGE)
    else:
        print(f"Unknown command: {cmd}")
        print(USAGE)


if __name__ == "__main__":
    asyncio.run(main())
