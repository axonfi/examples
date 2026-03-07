"""Scheduled payments — recurring transfers from an Axon vault.

Send payments on a schedule (every N hours, daily, weekly). Useful for payroll,
subscriptions, API credits, or any repeating transfer.

Reads a schedule from schedule.json and runs continuously, checking every minute
whether any payment is due. Tracks last-paid timestamps in state.json so it
survives restarts.

Usage:
    pip install -r requirements.txt
    cp .env.example .env
    # Edit .env with your vault and bot key
    # Edit schedule.json with your payment schedule
    python scheduler.py              # run continuously
    python scheduler.py --once       # check once and exit
    python scheduler.py --dry-run    # show what would be paid without sending
"""

import argparse
import asyncio
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

from axonfi import AxonClient, Chain

load_dotenv()

SCHEDULE_FILE = Path(__file__).parent / "schedule.json"
STATE_FILE = Path(__file__).parent / "state.json"
CHECK_INTERVAL = 60  # seconds between checks


def load_client() -> AxonClient:
    return AxonClient(
        vault_address=os.environ["AXON_VAULT_ADDRESS"],
        chain_id=int(os.environ.get("AXON_CHAIN_ID", str(Chain.BaseSepolia))),
        bot_private_key=os.environ["AXON_BOT_PRIVATE_KEY"],
    )


def load_schedule() -> list[dict]:
    with open(SCHEDULE_FILE) as f:
        return json.load(f)


def load_state() -> dict:
    if STATE_FILE.exists():
        with open(STATE_FILE) as f:
            return json.load(f)
    return {}


def save_state(state: dict):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)


def interval_seconds(interval: str) -> int:
    """Parse interval string to seconds. E.g. '24h', '7d', '30m'."""
    unit = interval[-1].lower()
    value = int(interval[:-1])
    if unit == "m":
        return value * 60
    if unit == "h":
        return value * 3600
    if unit == "d":
        return value * 86400
    raise ValueError(f"Unknown interval unit: {interval} (use m/h/d)")


async def check_and_pay(client: AxonClient, schedule: list[dict], state: dict, dry_run: bool = False) -> dict:
    """Check each scheduled payment and send if due. Returns updated state."""
    now = time.time()
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    for entry in schedule:
        name = entry["name"]
        to = entry["to"]
        token = entry["token"]
        amount = entry["amount"]
        interval = entry["interval"]

        interval_secs = interval_seconds(interval)
        last_paid = state.get(name, {}).get("last_paid_at", 0)
        elapsed = now - last_paid

        if elapsed < interval_secs:
            remaining = interval_secs - elapsed
            hours = int(remaining // 3600)
            mins = int((remaining % 3600) // 60)
            print(f"  [{name}] Next in {hours}h {mins}m")
            continue

        print(f"  [{name}] DUE — {amount} {token} -> {to[:10]}...{to[-4:]}")

        if dry_run:
            print(f"    (dry run, skipping)")
            continue

        try:
            result = await client.pay(
                to=to,
                token=token,
                amount=float(amount),
                memo=f"Scheduled: {name}",
            )
            print(f"    Status: {result.status}")
            if result.tx_hash:
                print(f"    TX: {result.tx_hash}")
            if result.reason:
                print(f"    Reason: {result.reason}")

            if result.status == "approved":
                state[name] = {
                    "last_paid_at": now,
                    "last_paid_str": now_str,
                    "last_tx": result.tx_hash,
                }
            elif result.status == "rejected":
                print(f"    Payment rejected — will retry next cycle")
        except Exception as e:
            print(f"    Error: {e}")

    return state


async def main():
    parser = argparse.ArgumentParser(description="Axon scheduled payments")
    parser.add_argument("--once", action="store_true", help="Check once and exit")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be paid")
    args = parser.parse_args()

    if not SCHEDULE_FILE.exists():
        print(f"No schedule file found at {SCHEDULE_FILE}")
        print(f"Create one — see schedule.json.example")
        sys.exit(1)

    schedule = load_schedule()
    print(f"Loaded {len(schedule)} scheduled payments")
    for entry in schedule:
        print(f"  {entry['name']}: {entry['amount']} {entry['token']} every {entry['interval']}")
    print()

    client = load_client()
    print(f"Vault: {os.environ['AXON_VAULT_ADDRESS']}")
    print(f"Bot:   {client.bot_address}")
    print()

    if args.once or args.dry_run:
        state = load_state()
        state = await check_and_pay(client, schedule, state, dry_run=args.dry_run)
        if not args.dry_run:
            save_state(state)
        await client.close()
        return

    print(f"Running continuously (checking every {CHECK_INTERVAL}s)...\n")
    try:
        while True:
            now_str = datetime.now(timezone.utc).strftime("%H:%M UTC")
            print(f"[{now_str}] Checking schedule...")
            state = load_state()
            state = await check_and_pay(client, schedule, state)
            save_state(state)
            print()
            await asyncio.sleep(CHECK_INTERVAL)
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        await client.close()


if __name__ == "__main__":
    asyncio.run(main())
