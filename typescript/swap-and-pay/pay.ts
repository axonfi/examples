/**
 * Swap-and-pay — Pay in any token, even if the vault doesn't hold it.
 *
 * Demonstrates Axon's automatic swap routing. The bot requests a payment
 * in USDC, but the vault only has WETH. The relayer detects this, finds a
 * Uniswap route (WETH -> USDC), swaps the exact amount needed, and sends
 * the payment — all in a single transaction. The bot doesn't need to know
 * which tokens the vault holds.
 *
 * Setup:
 *   1. Deploy vault on Base Sepolia, register bot
 *   2. Fund vault with WETH (NOT USDC) — this forces the swap route
 *   3. Set bot maxPerTxAmount high enough (or 0 for no cap)
 *
 * Usage:
 *   cp .env.example .env
 *   npm install
 *   npx tsx pay.ts                  # pay 0.01 USDC (default)
 *   npx tsx pay.ts 5                # pay 5 USDC
 *   npx tsx pay.ts balance          # check vault WETH + USDC balances
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

const RECIPIENT = process.env.RECIPIENT as `0x${string}`;
if (!RECIPIENT) {
  console.error('Set RECIPIENT in .env (address to receive payment)');
  process.exit(1);
}

// Circle USDC on Base Sepolia
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;
// Wrapped ETH on Base Sepolia
const WETH = '0x4200000000000000000000000000000000000006' as const;

// ── Commands ────────────────────────────────────────────────────────────────

async function cmdPay(amountUsdc: number) {
  console.log(`\nPaying ${amountUsdc} USDC to ${RECIPIENT.slice(0, 10)}...`);
  console.log(`  (vault may not hold USDC — relayer will swap WETH -> USDC if needed)`);

  // The bot just says "pay X USDC". If the vault has USDC, it sends directly.
  // If the vault only has WETH, the relayer automatically:
  //   1. Gets a Uniswap quote (WETH -> USDC)
  //   2. Builds swap calldata
  //   3. Calls executePayment() with the swap params
  //   4. The vault swaps WETH -> USDC and sends USDC to the recipient
  let result = await axon.pay({
    to: RECIPIENT,
    token: 'USDC',
    amount: amountUsdc,
    memo: `Swap-and-pay example: ${amountUsdc} USDC`,
  });

  // If payment triggers AI scan, poll for result
  if (result.requestId && !result.txHash) {
    for (let i = 0; i < 30; i++) {
      result = await axon.poll(result.requestId);
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
Swap-and-pay — pay in USDC even when vault only has WETH

Usage:
  npx tsx pay.ts                  Pay 0.01 USDC (default)
  npx tsx pay.ts 5                Pay 5 USDC
  npx tsx pay.ts balance          Show vault balances
  npx tsx pay.ts help             Show this message
`;

async function main() {
  const cmd = process.argv[2] ?? '0.01';

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

  await cmdPay(amount);
  await cmdBalance();
}

main().catch((err) => {
  console.error('Error:', err.message ?? err);
  process.exit(1);
});
