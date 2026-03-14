# Vault Rebalance

Swap tokens inside the vault without sending to anyone. Demonstrates `executeSwap()` with bot-signed input parameters.

## What it shows

- **`fromToken`** — the bot signs which token to sell (prevents relayer substitution)
- **`maxFromAmount`** — the bot signs a cost cap (prevents overspending)
- **`toToken`** — desired output token
- **`minToAmount`** — slippage floor

The relayer gets a Uniswap quote and verifies it falls within the bot's signed bounds before executing on-chain.

## Usage

```bash
npm install
cp .env.example .env  # fill in vault address + bot key

npx tsx rebalance.ts              # swap up to 1 USDC -> WETH
npx tsx rebalance.ts 5            # swap up to 5 USDC -> WETH
npx tsx rebalance.ts balance      # check vault balances
```

## How it works

1. Bot signs a `SwapIntent` with `fromToken=USDC`, `maxFromAmount=5`, `toToken=WETH`, `minToAmount=1wei`
2. Relayer gets a Uniswap V3 quote for the exact output
3. Relayer verifies `quoteInputAmount <= maxFromAmount` (bot's cost cap)
4. Relayer submits `executeSwap()` on-chain
5. Vault swaps via approved router, output WETH stays in vault
