"""
Axon Vault Setup — Full programmatic setup from scratch.

Deploys a vault, generates a bot keypair, registers the bot with spending
limits, deposits funds, and makes a test payment. No dashboard needed.

Usage:
    cp .env.example .env   # add your owner private key
    pip install -r requirements.txt
    python setup.py
"""

import os
import sys

from dotenv import load_dotenv
from eth_account import Account
from web3 import Web3

from axonfi import (
    AxonClientSync,
    BotConfigInput,
    Chain,
    SpendingLimitInput,
    WINDOW_ONE_DAY,
    add_bot,
    deploy_vault,
    deposit,
)

load_dotenv()

OWNER_KEY = os.environ.get("OWNER_PRIVATE_KEY")
if not OWNER_KEY:
    print("Set OWNER_PRIVATE_KEY in .env (funded with testnet ETH)")
    sys.exit(1)

RPC_URL = os.environ.get("RPC_URL", "https://sepolia.base.org")
CHAIN_ID = Chain.BaseSepolia


def main():
    # ── 1. Connect ─────────────────────────────────────────────────────
    w3 = Web3(Web3.HTTPProvider(RPC_URL))
    owner = Account.from_key(OWNER_KEY)
    print(f"Owner: {owner.address}")

    # ── 2. Deploy vault ────────────────────────────────────────────────
    print("\nDeploying vault...")
    vault_address = deploy_vault(w3, owner, CHAIN_ID)
    print(f"Vault deployed: {vault_address}")

    # ── 3. Generate bot keypair ────────────────────────────────────────
    bot_account = Account.create()
    bot_key = bot_account.key.hex()
    print(f"\nBot address: {bot_account.address}")
    print(f"Bot private key: 0x{bot_key}")
    print("  (save this key securely — you cannot recover it)")

    # ── 4. Register bot with spending limits ───────────────────────────
    print("\nRegistering bot...")
    add_bot(
        w3,
        owner,
        vault_address,
        bot_account.address,
        BotConfigInput(
            max_per_tx_amount=100,  # $100 hard cap per transaction
            max_rebalance_amount=0,  # no rebalance cap
            spending_limits=[
                SpendingLimitInput(
                    amount=1000,  # $1,000 rolling daily limit
                    max_count=0,  # no transaction count limit
                    window_seconds=WINDOW_ONE_DAY,
                ),
            ],
            ai_trigger_threshold=50,  # AI scan for payments above $50
            require_ai_verification=False,
        ),
    )
    print("Bot registered.")

    # ── 5. Deposit ETH into the vault ──────────────────────────────────
    print("\nDepositing 0.001 ETH...")
    deposit(w3, owner, vault_address, "ETH", 0.001)
    print("Deposit complete.")

    # ── 6. Make a test payment ─────────────────────────────────────────
    print("\nSending test payment (0.0001 ETH)...")
    client = AxonClientSync(
        vault_address=vault_address,
        chain_id=CHAIN_ID,
        bot_private_key=f"0x{bot_key}",
    )

    result = client.pay(
        to=owner.address,  # pay back to owner (just a test)
        token="ETH",
        amount=0.0001,
        memo="Hello from Axon vault-setup example",
    )

    print(f"Payment status: {result.status}")
    if result.tx_hash:
        print(f"Transaction: https://sepolia.basescan.org/tx/{result.tx_hash}")

    # ── 7. Check vault value (USD) ──────────────────────────────────────
    print("\nChecking vault value...")
    value = client.get_vault_value()
    print(f"Total vault value: ${value.total_value_usd}")
    for t in value.tokens:
        print(f"  {t.symbol}: ${t.value_usd}")

    # ── 8. Token helpers ─────────────────────────────────────────────────
    print("\nToken helpers:")
    print(f"  USDC address: {client.usdc_address}")
    print(f"  WETH address: {client.token_address('WETH')}")
    print(f"  USDC decimals: {client.token_decimals('USDC')}")

    # ── Done ───────────────────────────────────────────────────────────
    print("\n--- Setup Complete ---")
    print(f"Vault:    {vault_address}")
    print(f"Bot:      {bot_account.address}")
    print(f"Chain:    Base Sepolia ({CHAIN_ID})")
    print("\nNext steps:")
    print("  1. Deposit USDC: Get test USDC from https://faucet.circle.com/")
    print("  2. View in dashboard: https://app.axonfi.xyz")
    print("  3. Use the bot key in your agent code")

    client.close()


if __name__ == "__main__":
    main()
