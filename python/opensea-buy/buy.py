"""
OpenSea NFT Buy Bot — buy NFTs from OpenSea into your Axon vault.

Demonstrates:
  - Fetching listings from the OpenSea API
  - Getting fulfillment calldata for Seaport orders
  - Buying NFTs via execute() (vault receives the NFT)
  - WETH approval flow for Seaport payments

Usage:
  python buy.py listings <collection-slug>
  python buy.py buy <collection-slug>
  python buy.py collection <collection-slug>
"""

import os
import sys
import time

import requests
from dotenv import load_dotenv
from eth_abi import encode

from axonfi import AxonClient

load_dotenv()

# ── Config ───────────────────────────────────────────────────────────────────

CHAIN_ID = int(os.environ.get("AXON_CHAIN_ID", "84532"))
IS_TESTNET = CHAIN_ID == 84532
OPENSEA_CHAIN = "base_sepolia" if IS_TESTNET else "base"
OPENSEA_API_KEY = os.environ.get("OPENSEA_API_KEY", "")
OPENSEA_BASE = "https://api.opensea.io"

# Seaport 1.6 — same address on all EVM chains
SEAPORT = "0x0000000000000068F116a894984e2DB1123eB395"

# WETH addresses
WETH = {
    84532: "0x4200000000000000000000000000000000000006",
    8453: "0x4200000000000000000000000000000000000006",
}

if not OPENSEA_API_KEY:
    print("Error: OPENSEA_API_KEY is required.")
    print("Get one at https://docs.opensea.io/reference/api-keys")
    sys.exit(1)

axon = AxonClient(
    vault_address=os.environ["AXON_VAULT_ADDRESS"],
    chain_id=CHAIN_ID,
    bot_private_key=os.environ["AXON_BOT_PRIVATE_KEY"],
    relayer_url=os.environ.get("AXON_RELAYER_URL", "https://relay.axonfi.xyz"),
)


# ── OpenSea API helpers ──────────────────────────────────────────────────────


def opensea_get(path: str) -> dict:
    """GET request to OpenSea API."""
    url = f"{OPENSEA_BASE}{path}"
    headers = {"Accept": "application/json", "X-API-KEY": OPENSEA_API_KEY}
    resp = requests.get(url, headers=headers, timeout=15)
    resp.raise_for_status()
    return resp.json()


def opensea_post(path: str, body: dict) -> dict:
    """POST request to OpenSea API."""
    url = f"{OPENSEA_BASE}{path}"
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-API-KEY": OPENSEA_API_KEY,
    }
    resp = requests.post(url, headers=headers, json=body, timeout=15)
    resp.raise_for_status()
    return resp.json()


def get_listings(collection_slug: str, limit: int = 5) -> list[dict]:
    """Get cheapest listings for a collection."""
    data = opensea_get(
        f"/api/v2/orders/{OPENSEA_CHAIN}/seaport/listings"
        f"?collection_slug={collection_slug}&order_by=eth_price&limit={limit}"
    )
    return data.get("orders", [])


def get_collection_info(slug: str) -> dict:
    """Get collection metadata."""
    return opensea_get(f"/api/v2/collections/{slug}")


def get_fulfillment_data(order_hash: str, fulfiller_address: str) -> dict:
    """Get Seaport fulfillment calldata from OpenSea."""
    return opensea_post(
        "/api/v2/listings/fulfillment",
        {
            "listing": {
                "hash": order_hash,
                "chain": OPENSEA_CHAIN,
                "protocol_address": SEAPORT,
            },
            "fulfiller": {"address": fulfiller_address},
        },
    )


# ── Helpers ──────────────────────────────────────────────────────────────────


def format_eth(wei: int) -> str:
    """Format wei as ETH string."""
    return f"{wei / 1e18:.6f}"


def encode_approve(spender: str, amount: int) -> str:
    """Encode ERC-20 approve(address,uint256) calldata."""
    selector = "0x095ea7b3"
    encoded = encode(["address", "uint256"], [spender, amount]).hex()
    return selector + encoded


def wait_for_result(request_id: str, label: str) -> dict:
    """Poll until execution completes."""
    for _ in range(60):
        result = axon.poll_execute(request_id)
        status = result.get("status", "unknown")
        if status == "approved":
            return result
        if status == "rejected":
            print(f"  {label} REJECTED: {result.get('reason', '?')}")
            return result
        if status == "pending_review":
            print(f"  {label}: sent to owner for review (check mobile app)")
        else:
            print(f"  {label}: {status}...")
        time.sleep(3)
    raise TimeoutError("Timed out waiting for result")


def print_result(result: dict):
    """Print execution result."""
    print(f"  Status: {result.get('status')}")
    explorer = "https://sepolia.basescan.org" if IS_TESTNET else "https://basescan.org"
    if result.get("txHash"):
        print(f"  TX: {explorer}/tx/{result['txHash']}")
    if result.get("reason"):
        print(f"  Reason: {result['reason']}")


# ── Commands ─────────────────────────────────────────────────────────────────


def cmd_listings(slug: str):
    """Browse floor listings for a collection."""
    print(f'\nFetching listings for "{slug}" on {OPENSEA_CHAIN}...\n')

    listings = get_listings(slug, limit=10)
    if not listings:
        print("No active listings found.")
        return

    for listing in listings:
        price_eth = format_eth(int(listing["current_price"]))
        offer = listing["protocol_data"]["parameters"]["offer"]
        token_id = offer[0]["identifierOrCriteria"] if offer else "?"
        nft_contract = offer[0]["token"] if offer else "unknown"

        print(f"  {price_eth} ETH — Token #{token_id}")
        print(f"    Contract: {nft_contract}")
        print(f"    Order: {listing['order_hash'][:18]}...")
        print()


def cmd_collection(slug: str):
    """Show collection info."""
    print(f"\nCollection: {slug}\n")
    info = get_collection_info(slug)
    print(f"  Name: {info.get('name', 'N/A')}")
    desc = info.get("description", "N/A") or "N/A"
    print(f"  Description: {desc[:200]}")
    print(f"  Supply: {info.get('total_supply', '?')}")
    for c in info.get("contracts", []):
        print(f"  Contract: {c['address']} ({c['chain']})")


def cmd_buy(slug: str):
    """Buy the cheapest listed NFT."""
    vault = axon.vault_address
    weth = WETH.get(CHAIN_ID)
    if not weth:
        print(f"No WETH address for chain {CHAIN_ID}")
        sys.exit(1)

    print(f'\n-- Buy cheapest NFT from "{slug}" --')
    print(f"  Vault: {vault}")
    print(f"  Chain: {OPENSEA_CHAIN}")
    print(f"  Seaport: {SEAPORT}\n")

    # 1. Get cheapest listing
    listings = get_listings(slug, limit=1)
    if not listings:
        print("No active listings found.")
        return

    listing = listings[0]
    price_wei = int(listing["current_price"])
    price_eth = format_eth(price_wei)
    offer = listing["protocol_data"]["parameters"]["offer"]
    token_id = offer[0]["identifierOrCriteria"] if offer else "?"
    nft_contract = offer[0]["token"] if offer else "unknown"

    print(f"  Found: Token #{token_id} at {price_eth} ETH")
    print(f"  NFT contract: {nft_contract}")
    print(f"  Seller: {listing['maker']['address']}")

    # 2. Get fulfillment calldata from OpenSea
    print("\n  Getting fulfillment data from OpenSea...")
    fulfillment = get_fulfillment_data(listing["order_hash"], vault)
    tx_data = fulfillment["fulfillment_data"]["transaction"]
    seaport_calldata = tx_data["input_data"]
    seaport_target = tx_data["to"]

    print(f"  Seaport target: {seaport_target}")

    # 3. Step 1: Approve WETH to Seaport
    print("\n  Step 1: Approve WETH to Seaport...")
    approve_calldata = encode_approve(SEAPORT, price_wei)

    result = axon.execute(
        protocol=weth,
        call_data=approve_calldata,
        token=weth,
        amount=0,
        protocol_name="WETH Approve for Seaport",
        memo=f"Approve {price_eth} WETH for NFT purchase",
    )

    if result.get("requestId") and not result.get("txHash"):
        result = wait_for_result(result["requestId"], "WETH approve")
    if result.get("status") != "approved":
        print("  WETH approval failed.")
        print_result(result)
        return
    print("  WETH approved.")

    # 4. Step 2: Execute the Seaport fulfillment
    print("\n  Step 2: Fulfill Seaport order...")
    result = axon.execute(
        protocol=seaport_target,
        call_data=seaport_calldata,
        token=weth,
        amount=price_wei,
        protocol_name="OpenSea Seaport",
        memo=f"Buy NFT #{token_id} from {slug} for {price_eth} ETH",
    )

    if result.get("requestId") and not result.get("txHash"):
        result = wait_for_result(result["requestId"], "Seaport buy")
    print_result(result)

    if result.get("status") == "approved":
        print(f"\n  NFT #{token_id} purchased and held by vault {vault}")


# ── CLI ──────────────────────────────────────────────────────────────────────

USAGE = """
OpenSea NFT Buy Bot — buy NFTs from OpenSea into your Axon vault

Commands:
  listings <collection-slug>   Browse floor listings
  buy <collection-slug>        Buy the cheapest listed NFT
  collection <collection-slug> Show collection info

Examples:
  python buy.py listings base-sepolia-nfts
  python buy.py buy base-sepolia-nfts
  python buy.py collection base-sepolia-nfts
"""


def main():
    if len(sys.argv) < 3 or sys.argv[1] in ("help", "-h", "--help"):
        print(USAGE)
        if len(sys.argv) >= 2 and sys.argv[1] not in ("help", "-h", "--help"):
            print("Error: collection slug is required.\n")
        return

    cmd = sys.argv[1].lower()
    slug = sys.argv[2]

    print(f"Vault: {axon.vault_address}")
    print(f"Bot:   {axon.bot_address}")
    print(f"Chain: {OPENSEA_CHAIN}")

    if cmd == "listings":
        cmd_listings(slug)
    elif cmd == "buy":
        cmd_buy(slug)
    elif cmd == "collection":
        cmd_collection(slug)
    else:
        print(f"Unknown command: {cmd}")
        print(USAGE)


if __name__ == "__main__":
    main()
