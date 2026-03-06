/**
 * Axon Vault Setup — Full programmatic setup from scratch.
 *
 * Deploys a vault, generates a bot keypair, registers the bot with spending
 * limits, deposits funds, and makes a test payment. No dashboard needed.
 *
 * Usage:
 *   cp .env.example .env   # add your owner private key
 *   npm install
 *   npx tsx setup.ts
 */

import {
  AxonClient,
  deployVault,
  addBot,
  deposit,
  createAxonPublicClient,
  createAxonWalletClient,
  Chain,
  WINDOW,
} from '@axonfi/sdk';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import 'dotenv/config';

const OWNER_KEY = process.env.OWNER_PRIVATE_KEY;
if (!OWNER_KEY) {
  console.error('Set OWNER_PRIVATE_KEY in .env (funded with testnet ETH)');
  process.exit(1);
}

const RPC_URL = process.env.RPC_URL ?? 'https://sepolia.base.org';
const CHAIN_ID = Chain.BaseSepolia;

async function main() {
  // ── 1. Create clients ───────────────────────────────────────────────
  const ownerWallet = createAxonWalletClient(OWNER_KEY as `0x${string}`, CHAIN_ID);
  const publicClient = createAxonPublicClient(CHAIN_ID, RPC_URL);

  const ownerAddress = ownerWallet.account!.address;
  console.log(`Owner: ${ownerAddress}`);

  // ── 2. Deploy vault ─────────────────────────────────────────────────
  console.log('\nDeploying vault...');
  const vaultAddress = await deployVault(ownerWallet, publicClient);
  console.log(`Vault deployed: ${vaultAddress}`);

  // ── 3. Generate bot keypair ─────────────────────────────────────────
  const botKey = generatePrivateKey();
  const botAccount = privateKeyToAccount(botKey);
  console.log(`\nBot address: ${botAccount.address}`);
  console.log(`Bot private key: ${botKey}`);
  console.log('  (save this key securely — you cannot recover it)');

  // ── 4. Register bot with spending limits ────────────────────────────
  console.log('\nRegistering bot...');
  await addBot(ownerWallet, publicClient, vaultAddress, botAccount.address, {
    maxPerTxAmount: 100, // $100 hard cap per transaction
    maxRebalanceAmount: 0, // no rebalance cap
    spendingLimits: [
      {
        amount: 1000, // $1,000 rolling daily limit
        maxCount: 0, // no transaction count limit
        windowSeconds: WINDOW.ONE_DAY,
      },
    ],
    aiTriggerThreshold: 50, // AI scan for payments above $50
    requireAiVerification: false,
  });
  console.log('Bot registered.');

  // ── 5. Deposit ETH into the vault ───────────────────────────────────
  console.log('\nDepositing 0.001 ETH...');
  await deposit(ownerWallet, publicClient, vaultAddress, 'ETH', 0.001);
  console.log('Deposit complete.');

  // ── 6. Make a test payment ──────────────────────────────────────────
  console.log('\nSending test payment (0.0001 ETH)...');
  const axon = new AxonClient({
    vaultAddress,
    chainId: CHAIN_ID,
    botPrivateKey: botKey,
  });

  const result = await axon.pay({
    to: ownerAddress, // pay back to owner (just a test)
    token: 'ETH',
    amount: 0.0001,
    memo: 'Hello from Axon vault-setup example',
  });

  console.log(`Payment status: ${result.status}`);
  if (result.txHash) {
    console.log(`Transaction: https://sepolia.basescan.org/tx/${result.txHash}`);
  }

  // ── Done ────────────────────────────────────────────────────────────
  console.log('\n--- Setup Complete ---');
  console.log(`Vault:    ${vaultAddress}`);
  console.log(`Bot:      ${botAccount.address}`);
  console.log(`Chain:    Base Sepolia (${CHAIN_ID})`);
  console.log(`\nNext steps:`);
  console.log(`  1. Deposit USDC: Get test USDC from https://faucet.circle.com/`);
  console.log(`  2. View in dashboard: https://app.axonfi.xyz`);
  console.log(`  3. Use the bot key in your agent code`);
}

main().catch((err) => {
  console.error('Setup failed:', err.message ?? err);
  process.exit(1);
});
