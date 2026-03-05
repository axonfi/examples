"""Simple CLI for Axon vault payments.

Usage:
    python cli.py pay <to> <token> <amount> [--memo TEXT]
    python cli.py balance [TOKEN]
    python cli.py poll <request_id>
    python cli.py status
"""

import argparse
import os
import sys

from dotenv import load_dotenv

from axonfi import AxonClientSync, Chain, KNOWN_TOKENS, resolve_token

load_dotenv()


def get_client() -> AxonClientSync:
    return AxonClientSync(
        vault_address=os.environ["AXON_VAULT_ADDRESS"],
        chain_id=int(os.environ.get("AXON_CHAIN_ID", str(Chain.BaseSepolia))),
        bot_private_key=os.environ["AXON_BOT_PRIVATE_KEY"],
    )


def cmd_pay(args):
    client = get_client()
    print(f"Paying {args.amount} {args.token} to {args.to}...")
    result = client.pay(to=args.to, token=args.token, amount=float(args.amount), memo=args.memo)
    print(f"Status: {result.status}")
    if result.tx_hash:
        print(f"TX: {result.tx_hash}")
    if result.request_id:
        print(f"Request ID: {result.request_id}")
    if result.reason:
        print(f"Reason: {result.reason}")


def cmd_balance(args):
    client = get_client()
    token = args.token or "USDC"
    chain_id = int(os.environ.get("AXON_CHAIN_ID", str(Chain.BaseSepolia)))
    token_address = resolve_token(token, chain_id)
    balance_raw = client.get_balance(token_address)
    info = KNOWN_TOKENS.get(token)
    if info:
        human = balance_raw / (10 ** info.decimals)
        print(f"{human:.6f} {token}")
    else:
        print(f"{balance_raw} base units")


def cmd_poll(args):
    client = get_client()
    result = client.poll(args.request_id)
    print(f"Status: {result.status}")
    if result.tx_hash:
        print(f"TX: {result.tx_hash}")
    if result.reason:
        print(f"Reason: {result.reason}")


def cmd_status(args):
    client = get_client()
    active = client.is_active()
    paused = client.is_paused()
    print(f"Bot: {client.bot_address}")
    print(f"Active: {active}")
    print(f"Vault paused: {paused}")


def main():
    parser = argparse.ArgumentParser(description="Axon CLI payments")
    sub = parser.add_subparsers(dest="command", required=True)

    p_pay = sub.add_parser("pay", help="Send a payment")
    p_pay.add_argument("to", help="Recipient address")
    p_pay.add_argument("token", help="Token symbol (USDC, WETH, ...)")
    p_pay.add_argument("amount", help="Amount (human-readable)")
    p_pay.add_argument("--memo", default="", help="Payment memo")
    p_pay.set_defaults(func=cmd_pay)

    p_bal = sub.add_parser("balance", help="Check token balance")
    p_bal.add_argument("token", nargs="?", default="USDC", help="Token symbol")
    p_bal.set_defaults(func=cmd_balance)

    p_poll = sub.add_parser("poll", help="Poll payment status")
    p_poll.add_argument("request_id", help="Request ID to poll")
    p_poll.set_defaults(func=cmd_poll)

    p_status = sub.add_parser("status", help="Check bot and vault status")
    p_status.set_defaults(func=cmd_status)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
