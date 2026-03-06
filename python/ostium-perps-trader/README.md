# Ostium Perps Trader

## What it does

Trade perpetuals on [Ostium](https://ostium.org) — BTC, ETH, forex, commodities, indices, and stocks — with your Axon vault as the trader.

The Axon vault holds your USDC and IS the trader on Ostium. When the bot opens a position, it signs an EIP-712 intent and the Axon relayer calls `executeProtocol()` on the vault. The vault approves USDC to Ostium's TradingStorage, then calls `openTrade` with `trader=vault`. Positions and gains belong to the vault, under owner control.

**Chain:** Arbitrum Sepolia (testnet)
**Protocol:** Ostium (leveraged perpetuals, 25+ markets)
**Collateral:** USDC (Ostium testnet USDC)

## How it works

```
1. Bot decides to open a position (e.g. 5x long BTC, $50 collateral)
2. Bot signs EIP-712 ExecuteIntent via Axon SDK
3. Relayer validates: spending limits, AI scan, simulation
4. Vault approves USDC to Ostium TradingStorage (persistent approval)
5. Vault calls Ostium Trading.openTrade() — vault IS the trader
6. Position belongs to the vault, visible on Ostium
```

The vault owner controls how much the bot can spend — per-transaction caps, daily limits, AI verification thresholds. The bot can only execute what's allowed.

## Available Markets

| ID | Market | ID | Market | ID | Market |
|----|--------|----|--------|----|--------|
| 0 | BTC/USD | 5 | XAU/USD (gold) | 10 | S&P 500 |
| 1 | ETH/USD | 7 | CL/USD (oil) | 18 | NVDA |
| 2 | EUR/USD | 8 | XAG/USD (silver) | 22 | TSLA |
| 9 | SOL/USD | 3 | GBP/USD | 12 | NASDAQ |

Full list in [Ostium docs](https://ostium.org).

## Setup

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Vault setup (one-time)

1. Deploy vault on Arbitrum Sepolia via [dashboard](https://app.axonfi.xyz)
2. Register a bot on the vault
3. Approve Ostium protocols on the vault:
   - Ostium Trading: `0x2A9B9c988393f46a2537B0ff11E98c2C15a95afe`
   - Ostium USDC: `0xe73B11Fb1e3eeEe8AF2a23079A4410Fe1B370548`
4. Set bot `maxPerTxAmount=0` (Ostium USDC has no Uniswap pool for oracle pricing)
5. Fund vault with Ostium testnet USDC (mint from Ostium faucet or transfer)

### 3. Configure .env

```bash
cp .env.example .env
```

Edit `.env`:
- `AXON_VAULT_ADDRESS` — your vault on Arbitrum Sepolia
- `AXON_BOT_PRIVATE_KEY` — bot key registered on the vault

## Usage

```bash
# Open a 5x long BTC position with $50 collateral
python trader.py open

# Close a position (defaults: pair 0, trade index 0, 100%)
python trader.py close

# Close 50% of a position
CLOSE_PCT=50 python trader.py close

# Close a specific trade index
TRADE_INDEX=1 python trader.py close

# Check current price for configured pair
python trader.py price

# Check vault Ostium USDC balance
python trader.py balance
```

### Quick test (hardcoded config)

```bash
python test_trade.py
```

## Customization

```bash
# Trade ETH with 10x leverage, short
PAIR_ID=1 LEVERAGE=10 DIRECTION=short python trader.py open

# Trade gold (XAU/USD) with $100 collateral
PAIR_ID=5 COLLATERAL_USDC=100 python trader.py open
```

## Example Output

```
Vault: 0xYourVault...
Bot:   0xYourBot...
Pair:  BTC/USD | Chain: Arbitrum Sepolia

Opening Long BTC/USD
  Collateral: 50.0 USDC | Leverage: 5.0x
  Notional: ~$250

  Approving USDC to TradingStorage...
  Approved! TX: 0xabc123...

  BTC/USD price: $70,013.58

  Opening trade...
  Trade opened! TX: 0xdef456...
```

## Monitoring Positions

Track your vault's open positions, PNL, and trade history in real time on the Ostium portfolio page:

```
https://app.ostium.com/portfolio/preview?address=<YOUR_VAULT_ADDRESS>
```

Make sure to select the correct network (testnet or mainnet) in the Ostium UI to match your vault's chain.

## Architecture: Vault-as-Trader

The Axon vault IS the Ostium trader. No separate wallet needed.

- **Axon vault** = treasury + trader (holds USDC, opens positions, owns gains)
- **Bot** = signs intents only (never touches funds or gas)
- **Relayer** = validates and submits on-chain (pays gas)

The vault calls `openTrade` with `trader=vault_address`, so positions are owned by the vault. The owner can view positions on Ostium using the vault address.
