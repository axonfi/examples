/**
 * Bot client that handles x402 paywalls automatically.
 *
 * Hits the express server's /api/weather endpoint, gets a 402 response,
 * uses the Axon SDK to pay via x402, then retries with the payment signature.
 *
 * Usage:
 *   # Start the server first (in another terminal):
 *   npx tsx server.ts
 *
 *   # Then run the bot:
 *   npx tsx bot-client.ts
 */

import 'dotenv/config';
import * as fs from 'fs';
import { AxonClient, Chain, decryptKeystore } from '@axonfi/sdk';
import type { Hex } from 'viem';

// ── Config ──────────────────────────────────────────────────────────────────

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3402';
const VAULT_ADDRESS = process.env.AXON_VAULT_ADDRESS as `0x${string}`;
const CHAIN_ID = Number(process.env.AXON_CHAIN_ID || Chain.BaseSepolia);

if (!VAULT_ADDRESS) {
  console.error('Set AXON_VAULT_ADDRESS in .env');
  process.exit(1);
}

// ── Load bot key ────────────────────────────────────────────────────────────

async function loadBotKey(): Promise<Hex> {
  if (process.env.AXON_BOT_PRIVATE_KEY) {
    return process.env.AXON_BOT_PRIVATE_KEY as Hex;
  }

  const keystorePath = process.env.AXON_BOT_KEYSTORE_PATH;
  const passphrase = process.env.AXON_BOT_PASSPHRASE;
  if (keystorePath && passphrase) {
    const keystore = JSON.parse(fs.readFileSync(keystorePath, 'utf8'));
    return await decryptKeystore(keystore, passphrase);
  }

  throw new Error('Set AXON_BOT_PRIVATE_KEY or AXON_BOT_KEYSTORE_PATH + AXON_BOT_PASSPHRASE');
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const botKey = await loadBotKey();
  const client = new AxonClient({
    vaultAddress: VAULT_ADDRESS,
    chainId: CHAIN_ID,
    botPrivateKey: botKey,
  });

  console.log(`Axon x402 Bot Client`);
  console.log(`  Vault:  ${VAULT_ADDRESS}`);
  console.log(`  Bot:    ${client.botAddress}`);
  console.log(`  Chain:  ${CHAIN_ID}`);
  console.log();

  // 1. Hit the paywalled endpoint
  const url = `${SERVER_URL}/api/weather`;
  console.log(`Fetching ${url}...`);

  const response = await fetch(url);
  console.log(`  Status: ${response.status}`);

  if (response.status !== 402) {
    // No paywall — just print the data
    const data = await response.json();
    console.log(`  Data:`, data);
    return;
  }

  // 2. Got 402 — handle the paywall with Axon SDK
  console.log(`  Got 402 — handling x402 payment...`);

  const result = await client.x402.handlePaymentRequired(response.headers);

  console.log(`  Payment funded!`);
  console.log(`    Request ID: ${result.fundingResult.requestId}`);
  console.log(`    Status:     ${result.fundingResult.status}`);
  if (result.fundingResult.txHash) {
    console.log(`    TX Hash:    ${result.fundingResult.txHash}`);
  }
  console.log(`    Amount:     ${result.selectedOption.amount} (base units)`);
  console.log(`    Merchant:   ${result.selectedOption.payTo}`);
  console.log();

  // 3. Retry with the payment signature
  console.log(`Retrying with PAYMENT-SIGNATURE header...`);

  const retryResponse = await fetch(url, {
    headers: { 'PAYMENT-SIGNATURE': result.paymentSignature },
  });

  console.log(`  Status: ${retryResponse.status}`);

  if (retryResponse.ok) {
    const data = await retryResponse.json();
    console.log(`  Weather data:`, JSON.stringify(data, null, 2));
  } else {
    console.error(`  Failed: ${retryResponse.statusText}`);
  }
}

main().catch(console.error);
