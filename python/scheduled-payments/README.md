# Scheduled Payments

## What it does

Sends recurring payments from your Axon vault on a schedule. Define who gets paid, how much, and how often in a simple JSON file. The bot runs continuously and handles the rest.

Use cases: API credits, data provider fees, subscription payments, payroll, recurring tips.

**Chain:** Base Sepolia (testnet)
**Token:** USDC (or any supported token)

## How it works

```
1. Bot reads schedule.json — list of recipients, amounts, intervals
2. Every 60 seconds, checks which payments are due
3. For due payments, signs EIP-712 PaymentIntent via Axon SDK
4. Relayer validates (spending limits, AI scan) and executes on-chain
5. Tracks last-paid timestamps in state.json (survives restarts)
```

The vault owner controls spending limits. If a scheduled payment exceeds the bot's per-tx cap or daily limit, it gets rejected and retried next cycle.

## Setup

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Configure

```bash
cp .env.example .env
cp schedule.json.example schedule.json
```

Edit `.env` with your vault address and bot key.
Edit `schedule.json` with your payment schedule.

### 3. Schedule format

```json
[
  {
    "name": "api-credits-alice",
    "to": "0x1234...5678",
    "token": "USDC",
    "amount": 5,
    "interval": "24h"
  }
]
```

Intervals: `30m` (minutes), `6h` (hours), `7d` (days).

## Usage

```bash
# Run continuously (checks every 60 seconds)
python scheduler.py

# Check once and exit
python scheduler.py --once

# Preview what would be paid (no transactions)
python scheduler.py --dry-run
```

## Example Output

```
Loaded 3 scheduled payments
  api-credits-alice: 5 USDC every 24h
  weekly-data-provider: 25 USDC every 7d
  hourly-oracle-fee: 0.1 USDC every 1h

Vault: 0xYourVault...
Bot:   0xYourBot...

Running continuously (checking every 60s)...

[14:30 UTC] Checking schedule...
  [api-credits-alice] DUE -- 5 USDC -> 0x1234...5678
    Status: approved
    TX: 0xabc123...
  [weekly-data-provider] Next in 3d 12h
  [hourly-oracle-fee] DUE -- 0.1 USDC -> 0x9876...5432
    Status: approved
    TX: 0xdef456...
```
