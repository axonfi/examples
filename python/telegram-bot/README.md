# Telegram Bot

## What it does

A Telegram bot that controls an Axon vault. Send payments, check balances, and monitor vault status — all from Telegram chat.

Only whitelisted Telegram usernames can use the bot. Payments go through the full Axon pipeline: spending limits, AI verification, and human review for flagged transactions.

**Chain:** Base Sepolia (testnet, configurable)

## Commands

| Command | Description | Example |
|---------|-------------|---------|
| `/balance [token]` | Check vault balance | `/balance` or `/balance WETH` |
| `/pay <addr> <amount> [token] [memo]` | Send payment | `/pay 0xABC 5 USDC invoice 42` |
| `/status` | Vault + bot status | `/status` |
| `/poll <id>` | Check pending payment | `/poll req_abc123` |

## Setup

### 1. Create Telegram Bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot`, follow prompts
3. Copy the bot token

### 2. Configure

```bash
pip install -r requirements.txt
cp .env.example .env
```

Edit `.env`:
- `TELEGRAM_BOT_TOKEN` — from BotFather
- `ALLOWED_TELEGRAM_USERS` — comma-separated Telegram usernames (no @)
- `AXON_VAULT_ADDRESS` — your vault address
- `AXON_BOT_PRIVATE_KEY` — bot key registered on the vault

### 3. Run

```bash
python bot.py
```

Message your bot on Telegram: `/start`

## Example

```
You: /balance
Bot: 💰 142.50 USDC

You: /pay 0x1234...5678 25 USDC API subscription
Bot: Sending 25.0 USDC to 0x1234...5678
Bot: ✅ Sent! TX: 0xabc123...

You: /pay 0x9999...0000 500 USDC large payment
Bot: Sending 500.0 USDC to 0x9999...0000
Bot: ⏳ Under review
     Request: req_xyz789
     Use /poll req_xyz789
```

## Security

- Only whitelisted Telegram users can interact
- All payments enforced by vault spending limits
- Large payments trigger AI verification + human review
- Bot key can be revoked instantly from the Axon dashboard
