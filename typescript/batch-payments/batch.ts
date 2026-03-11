/**
 * Batch payments — pay multiple recipients from an Axon vault in one run.
 *
 * Reads a CSV or JSON file of recipients and sends payments sequentially.
 * Useful for bounty payouts, revenue splitting, airdrops, or any scenario
 * where you need to pay a list of addresses.
 *
 * Each payment goes through the full Axon pipeline: spending limits, AI
 * verification, simulation — so the vault owner stays in control.
 *
 * Usage:
 *   npm install
 *   cp .env.example .env
 *   npx tsx batch.ts payments.json          # pay from JSON file
 *   npx tsx batch.ts payments.csv           # pay from CSV file
 *   npx tsx batch.ts payments.json --dry-run # preview without sending
 */

import { AxonClient, Chain } from '@axonfi/sdk';
import { readFileSync } from 'fs';
import 'dotenv/config';

// ── Config ──────────────────────────────────────────────────────────────────

const axon = new AxonClient({
  vaultAddress: process.env.AXON_VAULT_ADDRESS! as `0x${string}`,
  chainId: Number(process.env.AXON_CHAIN_ID ?? Chain.BaseSepolia),
  botPrivateKey: process.env.AXON_BOT_PRIVATE_KEY! as `0x${string}`,
});

interface Payment {
  to: string;
  token: string;
  amount: number;
  memo?: string;
}

// ── Parsers ─────────────────────────────────────────────────────────────────

function parseJson(content: string): Payment[] {
  const data = JSON.parse(content);
  if (!Array.isArray(data)) throw new Error('JSON must be an array of payments');
  return data.map((p: Record<string, unknown>, i: number) => {
    if (!p.to || !p.token || !p.amount) {
      throw new Error(`Payment ${i + 1}: missing required fields (to, token, amount)`);
    }
    return {
      to: String(p.to),
      token: String(p.token),
      amount: Number(p.amount),
      memo: p.memo ? String(p.memo) : undefined,
    };
  });
}

function parseCsv(content: string): Payment[] {
  const lines = content.trim().split('\n');
  if (lines.length < 2) throw new Error('CSV must have a header row and at least one payment');

  const header = lines[0]
    .toLowerCase()
    .split(',')
    .map((h) => h.trim());
  const toIdx = header.indexOf('to');
  const tokenIdx = header.indexOf('token');
  const amountIdx = header.indexOf('amount');
  const memoIdx = header.indexOf('memo');

  if (toIdx === -1 || tokenIdx === -1 || amountIdx === -1) {
    throw new Error('CSV must have columns: to, token, amount (and optional: memo)');
  }

  return lines
    .slice(1)
    .filter((l) => l.trim())
    .map((line, i) => {
      const cols = line.split(',').map((c) => c.trim());
      return {
        to: cols[toIdx],
        token: cols[tokenIdx],
        amount: Number(cols[amountIdx]),
        memo: memoIdx >= 0 ? cols[memoIdx] : undefined,
      };
    });
}

function loadPayments(filePath: string): Payment[] {
  const content = readFileSync(filePath, 'utf-8');
  if (filePath.endsWith('.csv')) return parseCsv(content);
  return parseJson(content);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const filePath = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');

  if (!filePath) {
    console.log('Usage: npx tsx batch.ts <payments.json|payments.csv> [--dry-run]');
    return;
  }

  const payments = loadPayments(filePath);

  console.log(`Vault: ${axon.vaultAddress}`);
  console.log(`Bot:   ${axon.botAddress}`);
  console.log(`Chain: ${process.env.AXON_CHAIN_ID ?? Chain.BaseSepolia}`);
  console.log(`\nLoaded ${payments.length} payments from ${filePath}`);
  if (dryRun) console.log('(dry run — no transactions will be sent)\n');
  else console.log();

  const total = payments.reduce((sum, p) => sum + p.amount, 0);
  console.log(`Total: ${total} (across all tokens)\n`);

  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < payments.length; i++) {
    const p = payments[i];
    const label = `[${i + 1}/${payments.length}]`;
    const shortAddr = `${p.to.slice(0, 8)}...${p.to.slice(-4)}`;

    console.log(`${label} ${p.amount} ${p.token} -> ${shortAddr}${p.memo ? ` (${p.memo})` : ''}`);

    if (dryRun) {
      console.log(`  (skipped)\n`);
      continue;
    }

    try {
      const result = await axon.pay({
        to: p.to as `0x${string}`,
        token: p.token,
        amount: p.amount,
        memo: p.memo ?? `Batch ${i + 1}/${payments.length}`,
      });

      // Poll if async
      let status = result.status;
      let txHash = result.txHash;
      let reason = result.reason;

      if (result.requestId && !result.txHash) {
        for (let j = 0; j < 30; j++) {
          const poll = await axon.poll(result.requestId);
          if (poll.status === 'approved' || poll.status === 'rejected') {
            status = poll.status;
            txHash = poll.txHash;
            reason = poll.reason;
            break;
          }
          await new Promise((r) => setTimeout(r, 2000));
        }
      }

      console.log(`  Status: ${status}`);
      if (txHash) console.log(`  TX: ${txHash}`);
      if (reason) console.log(`  Reason: ${reason}`);

      if (status === 'approved') succeeded++;
      else failed++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  Error: ${msg}`);
      failed++;
    }
    console.log();
  }

  if (!dryRun) {
    console.log(`Done: ${succeeded} succeeded, ${failed} failed out of ${payments.length}`);
  }
}

main().catch((err) => {
  console.error('Error:', err.message ?? err);
  process.exit(1);
});
