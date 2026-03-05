# DeFi Trading Agent

## What it does

Auto-buys ETH when the price dips. Like a DCA (dollar-cost averaging) bot, but the funds never leave your vault.

Every 30 seconds, the bot checks ETH/USD price on CoinGecko. When ETH drops below $2,000, it automatically swaps 10 USDC into WETH inside the vault via Uniswap on Base. The WETH stays in the vault — no tokens are sent anywhere.

**Chain:** Base Sepolia (testnet, free)
**Swap:** USDC → WETH via Uniswap V3 (0.3% fee pool)
**Price feed:** CoinGecko API (free, no key needed)
**Strategy:** Buy WETH when ETH < $2,000, swap 10 USDC per trigger, 5% slippage tolerance

## How it works

```
[every 30 seconds]
1. Fetch ETH/USD from CoinGecko
2. If ETH < $2,000:
   → Calculate min WETH output (10 USDC / price * 0.95)
   → Call AxonClient.swap(to_token="WETH", from_token="USDC", max_from_amount=10)
   → Relayer routes through Uniswap V3 on Base
   → WETH lands in the vault
3. If ETH >= $2,000: do nothing, wait 30 seconds
```

The relayer handles the Uniswap routing. Your vault's spending limits and AI verification still apply — if the bot tries to swap too much, it gets blocked.

## Example Output

```
DeFi Trading Agent
Bot: 0xda964c6C53394d9d9E49DfA29C2db39aB74fC74F
Strategy: Buy WETH when ETH < $2000
Swap size: 10.0 USDC per trigger

ETH: $2,145.30 — holding
ETH: $2,139.80 — holding
ETH: $1,987.50 < $2000 — swapping 10.0 USDC → WETH
  Result: approved TX: 0xdef456...
ETH: $1,992.10 < $2000 — swapping 10.0 USDC → WETH
  Result: approved TX: 0x789abc...
ETH: $2,015.40 — holding
```

## Setup

```bash
pip install -r requirements.txt
cp .env.example .env  # Fill in AXON_VAULT_ADDRESS, AXON_BOT_PRIVATE_KEY
python agent.py
```

## Customization

Edit the constants at the top of `agent.py`:

```python
BUY_BELOW_USD = 2000.0   # Buy when ETH drops below this price
SWAP_AMOUNT_USDC = 10.0  # How much USDC to swap each time
POLL_INTERVAL = 30        # How often to check (seconds)
```
