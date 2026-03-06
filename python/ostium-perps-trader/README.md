# Ostium Perps Trader

## What it does

Trade perpetuals on [Ostium](https://ostium.org) — BTC, ETH, forex, commodities, indices, and stocks — with your Axon vault as the treasury.

The Axon vault holds your USDC. When the bot wants to open a position, it draws exactly the collateral it needs from the vault (subject to your spending limits and AI verification), then trades via the [Ostium Python SDK](https://github.com/0xOstium/ostium-python-sdk).

**Chain:** Arbitrum Sepolia (testnet)
**Protocol:** Ostium (leveraged perpetuals, 25+ markets)
**Collateral:** USDC (Ostium testnet USDC)

## How it works

```
1. Bot decides to open a position (e.g. 5x long BTC, $50 collateral)
2. Checks Ostium trading wallet balance
3. If insufficient: calls axon.pay() to fund trader from vault
   → Axon enforces spending limits, AI scan, human review
4. Opens position via Ostium SDK (approve USDC → openTrade)
5. Manages positions: view, set TP/SL, close
```

The vault owner controls how much the bot can spend — per-transaction caps, daily limits, destination whitelists. The bot can only draw what's allowed.

## Available Markets

| ID | Market | ID | Market | ID | Market |
|----|--------|----|--------|----|--------|
| 0 | BTC/USD | 5 | XAU/USD (gold) | 10 | S&P 500 |
| 1 | ETH/USD | 7 | CL/USD (oil) | 18 | NVDA |
| 2 | EUR/USD | 8 | XAG/USD (silver) | 22 | TSLA |
| 9 | SOL/USD | 3 | GBP/USD | 12 | NASDAQ |

Full list in [Ostium docs](https://ostium.org).

## Setup

```bash
pip install -r requirements.txt
cp .env.example .env
```

Edit `.env`:
- `AXON_VAULT_ADDRESS` — your vault on Arbitrum Sepolia
- `AXON_BOT_PRIVATE_KEY` — bot key registered on the vault
- `OSTIUM_TRADER_KEY` — a separate wallet for Ostium trading (receives USDC from vault)
- `RPC_URL` — Arbitrum Sepolia RPC (free at [alchemy.com](https://alchemy.com))

Get testnet USDC from [Circle Faucet](https://faucet.circle.com/) and deposit into your vault.

## Usage

```bash
# Open a 5x long BTC position with $50 collateral
python trader.py open

# Check open positions
python trader.py positions

# Close a position (pair_id, trade_index)
python trader.py close 0 0

# Check current price
python trader.py price

# Check vault + trader balances
python trader.py balance

# Fund trader wallet from vault
python trader.py fund 100
```

## Example Output

```
Axon vault:  0x9BFc82f49D229E6c9461016049B93c7ce8171574
Axon bot:    0xda964c6C53394d9d9E49DfA29C2db39aB74fC74F
Ostium trader: 0x1234...5678
Pair: BTC/USD | Chain: Arbitrum Sepolia

Opening Long BTC/USD
  Collateral: 50.0 USDC | Leverage: 5.0x
  Notional: ~$250
  Trader USDC balance: 12.50
  Need 50.00 USDC, have 12.50 — funding 47.50 from vault
  Funding trader: 47.50 USDC from vault → 0x1234...
  Funded! TX: 0xabc123...
  BTC/USD price: $104,250.00
  Trade opened! TX: 0xdef456...
  Order ID: 42
```

## Customization

Edit `.env` or pass environment variables:

```bash
# Trade ETH with 10x leverage, short
PAIR_ID=1 LEVERAGE=10 DIRECTION=short python trader.py open

# Trade gold (XAU/USD) with $100 collateral
PAIR_ID=5 COLLATERAL_USDC=100 python trader.py open
```

## Architecture: Why Two Wallets?

Ostium requires the trading wallet to directly approve USDC to its contracts. Axon vaults use a relayer-based model (EIP-712 intents). Instead of trying to bridge these models, we use a simple pattern:

- **Axon vault** = treasury (holds the bulk of USDC, enforces spending policies)
- **Ostium wallet** = trading account (holds only what's needed for active positions)

The bot draws from the vault on-demand, keeping the minimum needed in the trading wallet. The vault owner sees every funding transaction in the dashboard and can cap how much the bot can draw.
