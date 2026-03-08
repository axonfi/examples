"""Uniswap V3 Liquidity Providing — mint and remove LP positions via Axon vault.

Demonstrates the multi-token approval pattern with executeProtocol().
Uniswap V3's NonfungiblePositionManager.mint() needs TWO token approvals
(USDC + WETH), but execute() only auto-approves ONE per call.

Solution — two execute() calls:
  1. Persistent WETH approval:  execute(protocol=WETH, amounts=[0], callData=approve(NPM, max))
     amounts=[0] tells the vault to skip its approve→revoke cycle, so the
     approval set by the calldata persists after the call.
  2. Mint LP position:  execute(protocol=NPM, tokens=[USDC], amounts=[X], callData=mint(...))
     Vault auto-approves USDC → NPM, NPM pulls USDC + WETH, vault revokes USDC.
     WETH uses the persistent approval from step 1.

The vault holds the LP NFT — only the owner can remove liquidity.

Setup (one-time):
  1. Deploy vault on Base Sepolia
  2. Register bot (maxPerTxAmount=0 for non-oracle tokens)
  3. Fund vault with USDC + WETH
  4. Approve NonfungiblePositionManager + WETH as protocols:
     cast send <vault> "approveProtocol(address)" 0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2
     cast send <vault> "approveProtocol(address)" 0x4200000000000000000000000000000000000006

Usage:
    pip install -r requirements.txt
    cp .env.example .env
    python lp.py mint              # provide liquidity (USDC + WETH)
    python lp.py remove <tokenId>  # remove liquidity + collect tokens
    python lp.py positions         # list vault's LP positions
    python lp.py balance           # check vault balances
"""

import asyncio
import os
import sys
import time

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

# ── Contract addresses (Base Sepolia) ──────────────────────────────────────

NPM = "0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2"  # NonfungiblePositionManager
USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
WETH = "0x4200000000000000000000000000000000000006"

FEE_TIER = 3000    # 0.3% pool (most common for USDC/WETH)
TICK_SPACING = 60  # tick spacing for 0.3% fee tier

USDC_AMOUNT = float(os.environ.get("USDC_AMOUNT", "0.5"))
WETH_AMOUNT = float(os.environ.get("WETH_AMOUNT", "0.0001"))

MAX_UINT128 = 2**128 - 1
MAX_UINT256 = 2**256 - 1

# ── ABI fragments ───────────────────────────────────────────────────────────

APPROVE_ABI = [{
    "name": "approve",
    "type": "function",
    "stateMutability": "nonpayable",
    "inputs": [
        {"name": "spender", "type": "address"},
        {"name": "amount", "type": "uint256"},
    ],
    "outputs": [{"type": "bool"}],
}]

MINT_ABI = [{
    "name": "mint",
    "type": "function",
    "stateMutability": "nonpayable",
    "inputs": [{
        "name": "params",
        "type": "tuple",
        "components": [
            {"name": "token0", "type": "address"},
            {"name": "token1", "type": "address"},
            {"name": "fee", "type": "uint24"},
            {"name": "tickLower", "type": "int24"},
            {"name": "tickUpper", "type": "int24"},
            {"name": "amount0Desired", "type": "uint256"},
            {"name": "amount1Desired", "type": "uint256"},
            {"name": "amount0Min", "type": "uint256"},
            {"name": "amount1Min", "type": "uint256"},
            {"name": "recipient", "type": "address"},
            {"name": "deadline", "type": "uint256"},
        ],
    }],
    "outputs": [
        {"name": "tokenId", "type": "uint256"},
        {"name": "liquidity", "type": "uint128"},
        {"name": "amount0", "type": "uint256"},
        {"name": "amount1", "type": "uint256"},
    ],
}]

DECREASE_LIQUIDITY_ABI = [{
    "name": "decreaseLiquidity",
    "type": "function",
    "stateMutability": "nonpayable",
    "inputs": [{
        "name": "params",
        "type": "tuple",
        "components": [
            {"name": "tokenId", "type": "uint256"},
            {"name": "liquidity", "type": "uint128"},
            {"name": "amount0Min", "type": "uint256"},
            {"name": "amount1Min", "type": "uint256"},
            {"name": "deadline", "type": "uint256"},
        ],
    }],
    "outputs": [
        {"name": "amount0", "type": "uint256"},
        {"name": "amount1", "type": "uint256"},
    ],
}]

COLLECT_ABI = [{
    "name": "collect",
    "type": "function",
    "stateMutability": "nonpayable",
    "inputs": [{
        "name": "params",
        "type": "tuple",
        "components": [
            {"name": "tokenId", "type": "uint256"},
            {"name": "recipient", "type": "address"},
            {"name": "amount0Max", "type": "uint128"},
            {"name": "amount1Max", "type": "uint128"},
        ],
    }],
    "outputs": [
        {"name": "amount0", "type": "uint256"},
        {"name": "amount1", "type": "uint256"},
    ],
}]

POSITION_ABI = [{
    "name": "positions",
    "type": "function",
    "stateMutability": "view",
    "inputs": [{"name": "tokenId", "type": "uint256"}],
    "outputs": [
        {"name": "nonce", "type": "uint96"},
        {"name": "operator", "type": "address"},
        {"name": "token0", "type": "address"},
        {"name": "token1", "type": "address"},
        {"name": "fee", "type": "uint24"},
        {"name": "tickLower", "type": "int24"},
        {"name": "tickUpper", "type": "int24"},
        {"name": "liquidity", "type": "uint128"},
        {"name": "feeGrowthInside0LastX128", "type": "uint256"},
        {"name": "feeGrowthInside1LastX128", "type": "uint256"},
        {"name": "tokensOwed0", "type": "uint128"},
        {"name": "tokensOwed1", "type": "uint128"},
    ],
}]

BALANCE_OF_ABI = [{
    "name": "balanceOf",
    "type": "function",
    "stateMutability": "view",
    "inputs": [{"name": "owner", "type": "address"}],
    "outputs": [{"type": "uint256"}],
}]

TOKEN_OF_OWNER_ABI = [{
    "name": "tokenOfOwnerByIndex",
    "type": "function",
    "stateMutability": "view",
    "inputs": [
        {"name": "owner", "type": "address"},
        {"name": "index", "type": "uint256"},
    ],
    "outputs": [{"type": "uint256"}],
}]

w3 = Web3(Web3.HTTPProvider(os.environ.get("RPC_URL", "https://sepolia.base.org")))


# ── Helpers ─────────────────────────────────────────────────────────────────


def encode(abi, fn_name, args):
    contract = w3.eth.contract(abi=abi)
    return contract.encode_abi(fn_name, args)


def cksum(addr):
    return Web3.to_checksum_address(addr)


async def wait_for_result(request_id: str, label: str = ""):
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


async def cmd_mint():
    usdc_amount = int(USDC_AMOUNT * 10**6)
    weth_amount = int(WETH_AMOUNT * 10**18)

    print(f"\n── Step 1: Persistent WETH approval to NonfungiblePositionManager ──")
    print(f"  This lets NPM pull WETH from the vault during mint.")
    print(f"  amount=0 means vault skips approve/revoke — the calldata's approval persists.\n")

    # approve(NPM, max_uint256) on WETH — the vault calls WETH.approve() directly
    call_data = encode(APPROVE_ABI, "approve", [cksum(NPM), MAX_UINT256])
    result = await axon.execute(
        protocol=WETH,
        call_data=call_data,
        tokens=[WETH],
        amounts=[0],           # 0 = skip vault's approve/revoke cycle
        protocol_name="WETH Approval",
        memo="Persistent WETH approval to NPM",
    )
    if result.request_id and not result.tx_hash:
        result = await wait_for_result(result.request_id, "approval ")
    print_result(result)
    if result.status != "approved":
        return

    print(f"\n── Step 2: Mint LP position ──")
    print(f"  {USDC_AMOUNT} USDC + {WETH_AMOUNT} WETH → full-range liquidity\n")

    # Uniswap requires token0 < token1 by address
    if USDC.lower() < WETH.lower():
        token0, token1 = cksum(USDC), cksum(WETH)
        amount0, amount1 = usdc_amount, weth_amount
    else:
        token0, token1 = cksum(WETH), cksum(USDC)
        amount0, amount1 = weth_amount, usdc_amount

    # Full-range ticks (must be divisible by TICK_SPACING)
    tick_lower = -887220
    tick_upper = 887220
    deadline = int(time.time()) + 900

    call_data = encode(MINT_ABI, "mint", [(
        token0, token1, FEE_TIER,
        tick_lower, tick_upper,
        amount0, amount1,
        0, 0,                      # min amounts (0 = accept any, testnet only)
        cksum(axon.vault_address),  # LP NFT goes to vault
        deadline,
    )])

    # Vault auto-approves USDC to NPM, NPM pulls USDC + WETH, vault revokes USDC
    result = await axon.execute(
        protocol=NPM,
        call_data=call_data,
        tokens=[USDC],
        amounts=[usdc_amount],
        protocol_name="Uniswap V3 Mint LP",
        memo=f"Mint {USDC_AMOUNT} USDC + {WETH_AMOUNT} WETH LP",
    )
    if result.request_id and not result.tx_hash:
        result = await wait_for_result(result.request_id, "mint ")
    print_result(result)


async def cmd_remove(token_id: int):
    print(f"\nRemoving liquidity from NFT #{token_id}...")

    # Read position to get liquidity amount
    npm = w3.eth.contract(address=cksum(NPM), abi=POSITION_ABI)
    pos = npm.functions.positions(token_id).call()
    liquidity = pos[7]

    if liquidity == 0:
        print(f"  Position #{token_id} has no liquidity to remove.")
        return

    print(f"  Liquidity: {liquidity}")
    deadline = int(time.time()) + 900

    # Step 1: decreaseLiquidity — marks tokens as "owed"
    print(f"\n── Step 1: Decrease liquidity ──")
    call_data = encode(DECREASE_LIQUIDITY_ABI, "decreaseLiquidity", [(
        token_id, liquidity, 0, 0, deadline,
    )])
    result = await axon.execute(
        protocol=NPM,
        call_data=call_data,
        tokens=[USDC],
        amounts=[0],  # no approval needed
        protocol_name="Uniswap V3 Decrease",
        memo=f"Decrease liquidity NFT #{token_id}",
    )
    if result.request_id and not result.tx_hash:
        result = await wait_for_result(result.request_id, "decrease ")
    print_result(result)
    if result.status != "approved":
        return

    # Step 2: collect — withdraws owed tokens to vault
    print(f"\n── Step 2: Collect tokens ──")
    call_data = encode(COLLECT_ABI, "collect", [(
        token_id,
        cksum(axon.vault_address),
        MAX_UINT128,
        MAX_UINT128,
    )])
    result = await axon.execute(
        protocol=NPM,
        call_data=call_data,
        tokens=[USDC],
        amounts=[0],
        protocol_name="Uniswap V3 Collect",
        memo=f"Collect tokens NFT #{token_id}",
    )
    if result.request_id and not result.tx_hash:
        result = await wait_for_result(result.request_id, "collect ")
    print_result(result)


async def cmd_positions():
    npm = w3.eth.contract(address=cksum(NPM), abi=BALANCE_OF_ABI + TOKEN_OF_OWNER_ABI + POSITION_ABI)
    count = npm.functions.balanceOf(cksum(axon.vault_address)).call()

    print(f"\nVault LP positions: {count}")
    for i in range(count):
        token_id = npm.functions.tokenOfOwnerByIndex(cksum(axon.vault_address), i).call()
        pos = npm.functions.positions(token_id).call()
        token0_label = "USDC" if pos[2].lower() == USDC.lower() else "WETH"
        token1_label = "USDC" if pos[3].lower() == USDC.lower() else "WETH"
        fee_pct = pos[4] / 10000
        print(f"  #{token_id}: {token0_label}/{token1_label} {fee_pct}% | liquidity: {pos[7]} | ticks: [{pos[5]}, {pos[6]}]")


async def cmd_balance():
    usdc_bal = await axon.get_balance(USDC)
    weth_bal = await axon.get_balance(WETH)
    print(f"\nVault balances:")
    print(f"  USDC: {usdc_bal / 10**6:.6f}")
    print(f"  WETH: {weth_bal / 10**18:.8f}")


# ── CLI ─────────────────────────────────────────────────────────────────────

USAGE = """
Uniswap V3 LP — provide liquidity via Axon vault

Commands:
  mint                Provide USDC + WETH liquidity (full range)
  remove <tokenId>    Remove liquidity + collect tokens
  positions           List vault's LP positions
  balance             Show vault USDC + WETH balances
  help                Show this message

Examples:
  python lp.py mint
  python lp.py positions
  python lp.py remove 12345
  USDC_AMOUNT=2 WETH_AMOUNT=0.001 python lp.py mint
"""


async def main():
    if len(sys.argv) < 2 or sys.argv[1].lower() == "help":
        print(USAGE)
        return

    cmd = sys.argv[1].lower()
    print(f"Vault: {axon.vault_address}")
    print(f"Bot:   {axon.bot_address}")
    print(f"Chain: Base Sepolia")

    if cmd == "mint":
        await cmd_mint()
    elif cmd == "remove":
        if len(sys.argv) < 3:
            print("Usage: python lp.py remove <tokenId>")
            return
        await cmd_remove(int(sys.argv[2]))
    elif cmd == "positions":
        await cmd_positions()
    elif cmd == "balance":
        await cmd_balance()
    else:
        print(f"Unknown command: {cmd}")
        print(USAGE)

    await axon.close()


if __name__ == "__main__":
    asyncio.run(main())
