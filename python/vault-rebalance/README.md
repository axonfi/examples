# Vault Rebalance

Swap tokens inside the vault without sending to anyone. Demonstrates `executeSwap()` with bot-signed input parameters.

## What it shows

- **`from_token`** — the bot signs which token to sell (prevents relayer substitution)
- **`max_from_amount`** — the bot signs a cost cap (prevents overspending)
- **`to_token`** — desired output token
- **`min_to_amount`** — slippage floor

The relayer gets a Uniswap quote and verifies it falls within the bot's signed bounds before executing on-chain.

## Usage

```bash
pip install -r requirements.txt
cp .env.example .env  # fill in vault address + bot key

python rebalance.py              # swap up to 1 USDC -> WETH
python rebalance.py 5            # swap up to 5 USDC -> WETH
python rebalance.py balance      # check vault balances
```
