# Batch Payments

## What it does

Pay multiple recipients from your Axon vault in one run. Load a JSON or CSV file of payments and the bot sends them sequentially, with full spending limit and AI verification on each one.

Use cases: bounty payouts, revenue splitting, airdrops, payroll runs, bulk API credit top-ups.

**Chain:** Base Sepolia (testnet)
**Token:** USDC (or any supported token)

## How it works

```
1. Bot reads payment list from JSON or CSV file
2. For each payment, signs EIP-712 PaymentIntent via Axon SDK
3. Relayer validates each payment (spending limits, AI scan, simulation)
4. Payments execute on-chain sequentially
5. Summary printed at the end (succeeded/failed)
```

Each payment goes through the full Axon pipeline independently. If one payment hits a spending limit, the rest still process.

## Setup

```bash
npm install
cp .env.example .env
cp payments.json.example payments.json  # edit with real addresses
```

## Usage

```bash
# Pay from JSON file
npx tsx batch.ts payments.json

# Pay from CSV file
npx tsx batch.ts payments.csv

# Preview without sending
npx tsx batch.ts payments.json --dry-run
```

### JSON format

```json
[
  { "to": "0x123...", "token": "USDC", "amount": 10, "memo": "Bounty #42" },
  { "to": "0xabc...", "token": "USDC", "amount": 25, "memo": "Revenue split" }
]
```

### CSV format

```csv
to,token,amount,memo
0x123...,USDC,10,Bounty payout
0xabc...,USDC,25,Revenue split
```

## Example Output

```
Vault: 0xYourVault...
Bot:   0xYourBot...
Chain: 84532

Loaded 3 payments from payments.json
Total: 40 (across all tokens)

[1/3] 10 USDC -> 0x1234...5678 (Bounty payout)
  Status: approved
  TX: 0xabc123...

[2/3] 25 USDC -> 0xabcd...abcd (Revenue split)
  Status: approved
  TX: 0xdef456...

[3/3] 5 USDC -> 0x9876...5432 (API credits)
  Status: approved
  TX: 0x789abc...

Done: 3 succeeded, 0 failed out of 3
```
