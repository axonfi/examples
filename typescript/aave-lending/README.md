# Aave V3 Lending

Supply and withdraw USDC to Aave V3 from an Axon vault on Base Sepolia.

**Key pattern:** Working with tokens NOT in Axon's built-in list. Aave on Base Sepolia uses its own test USDC (`0xba50Cd2A...`), not Circle's. You pass the raw contract address instead of a symbol like `'USDC'`.

## How it works

1. Bot encodes `pool.supply(USDC, amount, vault, 0)` calldata
2. Bot calls `axon.execute()` with the Aave Pool as the protocol
3. Axon vault approves USDC to the Pool, calls supply, then revokes approval
4. aTokens (aUSDC) accrue in the vault — earning yield under owner control

For withdrawals, no approval is needed — Aave Pool burns aTokens directly. Pass `amount: 0` to skip the approval step (see tip below).

> **Tip: `amount = 0` skips the approval cycle.** When you call `execute()` with `amount > 0`, the vault does: approve token to protocol → call protocol → revoke approval. When `amount = 0`, the vault skips approve/revoke and just calls the protocol directly. Use this for any protocol call where the vault doesn't need to grant token spending permission (withdrawals, claiming rewards, closing positions, etc.).

## Setup

```bash
npm install
cp .env.example .env   # add vault address and bot key
```

**One-time vault config** (owner must do this):

1. **Approve protocol** — the vault owner must whitelist the Aave Pool:
   ```
   cast send <VAULT> "approveProtocol(address)" 0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27 --private-key <OWNER_KEY> --rpc-url https://sepolia.base.org
   ```
2. **Set maxPerTxAmount=0** — Aave's test USDC has no Uniswap pool, so the on-chain TWAP oracle can't price it. Set the bot's per-tx cap to 0 (no cap) to bypass the oracle check. The relayer's off-chain spending limits still apply.

Get Aave test USDC from the [Aave faucet](https://staging.aave.com/faucet/) on Base Sepolia, then deposit it into your vault.

## Usage

```bash
npx tsx lend.ts supply             # supply 100 USDC (default)
npx tsx lend.ts withdraw           # withdraw 100 USDC
npx tsx lend.ts balance            # check USDC + aUSDC balances
SUPPLY_AMOUNT=500 npx tsx lend.ts supply   # custom amount
```
