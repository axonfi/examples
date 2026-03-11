# Uniswap V3 Liquidity Providing

## What it does

Provide liquidity on Uniswap V3 from your Axon vault. Mint a USDC/WETH LP position, remove liquidity, and collect fees — the vault holds the LP NFT.

**Chain:** Base Sepolia (testnet)
**Protocol:** Uniswap V3 NonfungiblePositionManager
**Tokens:** USDC + WETH

## How it works

```
1. Bot signs EIP-712 ExecuteIntent via Axon SDK
2. Relayer validates: spending limits, AI scan, simulation
3. Vault approves WETH to NonfungiblePositionManager (persistent approval)
4. Vault approves USDC to NPM, calls mint(), revokes USDC
5. LP NFT is minted to the vault — vault owns the position
```

### Multi-token approval pattern

Uniswap V3's `mint()` needs TWO token approvals (USDC + WETH), but `execute()` only auto-approves ONE per call. The solution:

1. **Persistent WETH approval:** Call `execute(amounts=[0])` with `approve(NPM, maxUint256)` as calldata. When `amounts=[0]`, the vault skips its approve/revoke cycle, so the approval persists.
2. **Mint with USDC:** Call `execute(tokens=[USDC], amounts=[X])` with `mint(...)` as calldata. The vault auto-approves USDC to NPM, NPM pulls both tokens, vault revokes USDC after.

This pattern works for any DeFi protocol that needs multiple token approvals.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Vault setup (one-time)

1. Deploy vault on Base Sepolia via [dashboard](https://app.axonfi.xyz)
2. Register a bot on the vault
3. Fund vault with USDC ([Circle Faucet](https://faucet.circle.com/)) and WETH
4. Approve NonfungiblePositionManager + WETH as protocols on the vault:
   ```bash
   cast send <vault> "approveProtocol(address)" 0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2 --private-key <owner-key> --rpc-url https://sepolia.base.org
   cast send <vault> "approveProtocol(address)" 0x4200000000000000000000000000000000000006 --private-key <owner-key> --rpc-url https://sepolia.base.org
   ```

### 3. Configure .env

```bash
cp .env.example .env
```

Edit `.env`:

- `AXON_VAULT_ADDRESS` — your vault on Base Sepolia
- `AXON_BOT_PRIVATE_KEY` — bot key registered on the vault

## Usage

```bash
# Provide liquidity (0.5 USDC + 0.0001 WETH, full range)
npx tsx lp.ts mint

# Custom amounts
USDC_AMOUNT=2 WETH_AMOUNT=0.001 npx tsx lp.ts mint

# List vault's LP positions
npx tsx lp.ts positions

# Remove liquidity and collect tokens
npx tsx lp.ts remove 12345

# Check vault balances
npx tsx lp.ts balance
```

## Example Output

```
Vault: 0xYourVault...
Bot:   0xYourBot...
Chain: Base Sepolia

-- Step 1: Persistent WETH approval to NonfungiblePositionManager --
  amount=0 means vault skips approve/revoke -- the calldata's approval persists.

  Status: approved
  TX: https://sepolia.basescan.org/tx/0xabc...

-- Step 2: Mint LP position --
  0.5 USDC + 0.0001 WETH -> full-range liquidity

  Status: approved
  TX: https://sepolia.basescan.org/tx/0xdef...
```

## Contract Addresses (Base Sepolia)

| Contract                   | Address                                      |
| -------------------------- | -------------------------------------------- |
| NonfungiblePositionManager | `0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2` |
| USDC                       | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| WETH                       | `0x4200000000000000000000000000000000000006` |
