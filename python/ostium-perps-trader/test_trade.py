"""Quick test: open a BTC long on Ostium via Axon vault execute().

The vault is the trader — it approves USDC to Ostium's trading storage,
calls openTrade, and the position belongs to the vault.

Ostium requires USDC approval on the TradingStorage contract (not Trading).
So we do two executeProtocol calls:
  1. Persistent approve: vault calls USDC.approve(tradingStorage, amount)
  2. Open trade: vault calls Trading.openTrade(...) with amount=0
"""

import asyncio
from web3 import Web3
from decimal import Decimal

from axonfi import AxonClient, Chain

# ── Config ───────────────────────────────────────────────────────────────────

VAULT = "0xe51eea58c8b4c8e502d1bcb8bb49bd1e662125fc"
BOT_KEY = "0x4646fa303c86ec95d50a9be26f808a0f37776606d4553f3971c8f90c6a286906"
CHAIN_ID = Chain.ArbitrumSepolia
RPC_URL = "https://arb-sepolia.g.alchemy.com/v2/4oXy1MEAVhnFuAj_VLaQx"

OSTIUM_TRADING = "0x2A9B9c988393f46a2537B0ff11E98c2C15a95afe"
OSTIUM_TRADING_STORAGE = "0x0b9F5243B29938668c9Cfbd7557A389EC7Ef88b8"
OSTIUM_USDC = "0xe73B11Fb1e3eeEe8AF2a23079A4410Fe1B370548"

# Trade params
PAIR_ID = 0  # BTC/USD
COLLATERAL = 50  # USDC
LEVERAGE = 5
DIRECTION = True  # Long
SLIPPAGE_PCT = 2  # 2%

# ── Helpers ──────────────────────────────────────────────────────────────────

def to_base_units(amount, decimals=6):
    return int(float(amount) * 10**decimals)

def convert_to_scaled_integer(value, precision=5, scale=18):
    precise_value = round(Decimal(str(value)) * (10 ** precision))
    return int(precise_value * (10 ** (scale - precision)))

PRECISION_2 = 10**2


async def get_btc_price():
    """Get BTC price from Ostium."""
    from ostium_python_sdk import OstiumSDK, NetworkConfig
    config = NetworkConfig.testnet()
    sdk = OstiumSDK(config, None, RPC_URL)
    price, _, _ = await sdk.price.get_price("BTC", "USD")
    return price


def encode_approve(spender: str, amount: int) -> str:
    """Encode ERC20 approve(spender, amount) calldata."""
    w3 = Web3()
    erc20_abi = [{"inputs": [{"name": "spender", "type": "address"}, {"name": "amount", "type": "uint256"}],
                  "name": "approve", "outputs": [{"type": "bool"}], "stateMutability": "nonpayable", "type": "function"}]
    contract = w3.eth.contract(abi=erc20_abi)
    return contract.encode_abi("approve", [Web3.to_checksum_address(spender), amount])


def encode_open_trade(vault_address: str, price: float) -> str:
    """Encode Ostium openTrade calldata with vault as trader."""

    # ABI: openTrade(Trade t, BuilderFee bf, uint8 orderType, uint256 slippageP)
    open_trade_abi = [{
        "inputs": [
            {
                "components": [
                    {"name": "collateral", "type": "uint256"},
                    {"name": "openPrice", "type": "uint192"},
                    {"name": "tp", "type": "uint192"},
                    {"name": "sl", "type": "uint192"},
                    {"name": "trader", "type": "address"},
                    {"name": "leverage", "type": "uint32"},
                    {"name": "pairIndex", "type": "uint16"},
                    {"name": "index", "type": "uint8"},
                    {"name": "buy", "type": "bool"},
                ],
                "name": "t",
                "type": "tuple",
            },
            {
                "components": [
                    {"name": "builder", "type": "address"},
                    {"name": "builderFee", "type": "uint32"},
                ],
                "name": "bf",
                "type": "tuple",
            },
            {"name": "orderType", "type": "uint8"},
            {"name": "slippageP", "type": "uint256"},
        ],
        "name": "openTrade",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    }]

    w3 = Web3()
    contract = w3.eth.contract(abi=open_trade_abi)

    trade = (
        convert_to_scaled_integer(COLLATERAL, precision=5, scale=6),  # collateral
        convert_to_scaled_integer(price),  # openPrice (18 decimals)
        0,  # tp (no take profit)
        0,  # sl (no stop loss)
        Web3.to_checksum_address(vault_address),  # trader = VAULT
        to_base_units(LEVERAGE, decimals=2),  # leverage
        PAIR_ID,  # pairIndex
        0,  # index
        DIRECTION,  # buy = True (long)
    )

    builder_fee = (
        "0x0000000000000000000000000000000000000000",  # zero address
        0,  # zero fee
    )

    order_type = 0  # MARKET
    slippage = int(SLIPPAGE_PCT * PRECISION_2)

    return contract.encode_abi("openTrade", [trade, builder_fee, order_type, slippage])


# ── Main ─────────────────────────────────────────────────────────────────────

async def main():
    axon = AxonClient(
        vault_address=VAULT,
        chain_id=CHAIN_ID,
        bot_private_key=BOT_KEY,
    )

    print(f"Vault: {VAULT}")
    print(f"Bot:   {axon.bot_address}")
    print()

    # Step 1: Check if vault already has USDC allowance to TradingStorage
    from web3 import Web3 as W3
    w3 = W3(W3.HTTPProvider(RPC_URL))
    erc20 = w3.eth.contract(address=W3.to_checksum_address(OSTIUM_USDC), abi=[
        {"inputs": [{"name": "owner", "type": "address"}, {"name": "spender", "type": "address"}],
         "name": "allowance", "outputs": [{"type": "uint256"}], "stateMutability": "view", "type": "function"}
    ])
    allowance = erc20.functions.allowance(
        W3.to_checksum_address(VAULT), W3.to_checksum_address(OSTIUM_TRADING_STORAGE)
    ).call()

    collateral_raw = int(COLLATERAL * 1_000_000)
    if allowance < collateral_raw:
        # Persistent approval: vault approves USDC to TradingStorage
        approve_amount = 1_000_000 * 10**6  # 1M USDC
        approve_calldata = encode_approve(OSTIUM_TRADING_STORAGE, approve_amount)

        print(f"Step 1: Approving USDC to TradingStorage...")
        result = await axon.execute(
            protocol=OSTIUM_USDC,
            call_data=approve_calldata,
            token=OSTIUM_USDC,
            amount=0,
            protocol_name="Ostium USDC Approve",
        )
        print(f"  Status: {result.status}")
        if result.tx_hash:
            print(f"  TX: {result.tx_hash}")
        elif result.request_id:
            print(f"  Request ID: {result.request_id}")
            print("  Waiting for approval...")
            result = await axon.poll_execute(result.request_id)
            print(f"  Status: {result.status}")
            if result.tx_hash:
                print(f"  TX: {result.tx_hash}")
        if result.reason:
            print(f"  Reason: {result.reason}")
            return
        print()
    else:
        print(f"Step 1: USDC already approved ({allowance / 1e6:.0f} USDC)")
        print()

    # Step 2: Get price
    print("Step 2: Fetching BTC price from Ostium...")
    price = await get_btc_price()
    print(f"  BTC/USD: ${price:,.2f}")
    print()

    # Step 3: Open trade
    calldata = encode_open_trade(VAULT, price)
    print(f"Step 3: Opening trade — {COLLATERAL} USDC @ {LEVERAGE}x {'Long' if DIRECTION else 'Short'} BTC/USD")
    result = await axon.execute(
        protocol=OSTIUM_TRADING,
        call_data=calldata,
        token=OSTIUM_USDC,
        amount=0,  # approval already on TradingStorage
        protocol_name="Ostium",
    )

    print(f"  Status: {result.status}")
    if result.tx_hash:
        print(f"  TX: {result.tx_hash}")
    elif result.request_id:
        print(f"  Request ID: {result.request_id}")
        print("  Waiting for trade execution...")
        result = await axon.poll_execute(result.request_id)
        print(f"  Status: {result.status}")
        if result.tx_hash:
            print(f"  TX: {result.tx_hash}")
    if result.reason:
        print(f"  Reason: {result.reason}")


if __name__ == "__main__":
    asyncio.run(main())
