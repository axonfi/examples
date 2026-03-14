/**
 * Vault rebalance — swap tokens inside the vault without sending to anyone.
 *
 * Demonstrates Axon's executeSwap() endpoint. The bot signs a SwapIntent
 * specifying:
 *   - toToken: what to buy (e.g. WETH)
 *   - minToAmount: minimum output (slippage floor)
 *   - fromToken: what to sell (e.g. USDC) — bot-signed, prevents relayer substitution
 *   - maxFromAmount: max input (cost cap) — bot-signed, prevents overspending
 *
 * The relayer gets a Uniswap quote, verifies it's within the bot's signed
 * bounds, and executes on-chain. Output tokens stay in the vault.
 *
 * Use cases: DCA bots, yield rebalancing, portfolio management.
 *
 * Setup:
 *   1. Deploy vault on Base Sepolia, register bot
 *   2. Fund vault with USDC
 *   3. Set bot maxRebalanceAmount high enough (or 0 for no cap)
 *
 * Usage:
 *   cp .env.example .env
 *   npm install
 *   npx tsx rebalance.ts                     # swap 1 USDC -> WETH (default)
 *   npx tsx rebalance.ts 5                   # swap up to 5 USDC -> WETH
 *   npx tsx rebalance.ts balance             # check vault USDC + WETH balances
 */

import { AxonClient, Chain } from '@axonfi/sdk';
import { formatUnits } from 'viem';
import 'dotenv/config';

// ── Axon client ─────────────────────────────────────────────────────────────

const axon = new AxonClient({
  vaultAddress: process.env.AXON_VAULT_ADDRESS! as `0x${string}`,
  chainId: Number(process.env.AXON_CHAIN_ID ?? Chain.BaseSepolia),
  botPrivateKey: process.env.AXON_BOT_PRIVATE_KEY! as `0x${string}`,
});

// Base Sepolia token addresses
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;
const WETH = '0x4200000000000000000000000000000000000006' as const;

// ── Commands ────────────────────────────────────────────────────────────────

async function cmdRebalance(maxUsdc: number) {
  console.log(`\nSwapping up to ${maxUsdc} USDC -> WETH (in-vault rebalance)`);
  console.log(`  fromToken:    USDC (bot-signed — relayer cannot change this)`);
  console.log(`  maxFromAmount: ${maxUsdc} USDC (bot-signed — caps input cost)`);
  console.log(`  toToken:      WETH`);

  // The bot signs: fromToken, maxFromAmount, toToken, minToAmount.
  // The relayer gets a Uniswap quote and verifies:
  //   - quote.fromAmount <= maxFromAmount (cost cap)
  //   - quote.toAmount >= minToAmount (slippage floor)
  // On-chain, the vault also checks maxRebalanceAmount per bot.
  // Calculate a reasonable minToAmount based on ~$2000/ETH with 10% slippage tolerance
  const estimatedEthPerUsdc = 1 / 2200; // conservative
  const minWeth = maxUsdc * estimatedEthPerUsdc * 0.9;
  // Convert to wei (18 decimals)
  const minWethWei = BigInt(Math.floor(minWeth * 1e18));

  console.log(`  minToAmount:  ${minWeth.toFixed(8)} WETH (${minWethWei} wei)\n`);

  let result = await axon.swap({
    toToken: 'WETH',
    minToAmount: minWethWei,
    fromToken: 'USDC',
    maxFromAmount: maxUsdc,
    memo: `Rebalance: up to ${maxUsdc} USDC -> WETH`,
  });

  // Poll if AI scan is triggered
  if (result.requestId && !result.txHash) {
    for (let i = 0; i < 30; i++) {
      result = await axon.pollSwap(result.requestId);
      if (result.status === 'approved' || result.status === 'rejected') break;
      console.log(`  status: ${result.status}...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  console.log(`  Status: ${result.status}`);
  if (result.txHash) {
    console.log(`  TX: https://sepolia.basescan.org/tx/${result.txHash}`);
  }
  if (result.reason) {
    console.log(`  Reason: ${result.reason}`);
  }
}

async function cmdBalance() {
  const [usdc, weth] = await Promise.all([axon.getBalance(USDC), axon.getBalance(WETH)]);

  console.log(`\nVault balances:`);
  console.log(`  USDC:  ${formatUnits(usdc, 6)}`);
  console.log(`  WETH:  ${formatUnits(weth, 18)}`);
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const USAGE = `
Vault rebalance — swap USDC -> WETH inside the vault

Usage:
  npx tsx rebalance.ts                     Swap up to 1 USDC -> WETH
  npx tsx rebalance.ts 5                   Swap up to 5 USDC -> WETH
  npx tsx rebalance.ts balance             Show vault balances
  npx tsx rebalance.ts help                Show this message
`;

async function main() {
  const cmd = process.argv[2] ?? '1';

  if (cmd === 'help') {
    console.log(USAGE);
    return;
  }
  if (cmd === 'balance') {
    console.log(`Vault: ${axon.vaultAddress}`);
    await cmdBalance();
    return;
  }

  console.log(`Vault: ${axon.vaultAddress}`);
  console.log(`Bot:   ${axon.botAddress}`);
  console.log(`Chain: Base Sepolia`);

  const amount = parseFloat(cmd);
  if (isNaN(amount)) {
    console.log(`Unknown command: ${cmd}`);
    console.log(USAGE);
    return;
  }

  await cmdBalance();
  await cmdRebalance(amount);
  await cmdBalance();
}

main().catch((err) => {
  console.error('Error:', err.message ?? err);
  process.exit(1);
});
