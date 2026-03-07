/**
 * Aave V3 Lending — Supply and withdraw USDC via Axon vault.
 *
 * Demonstrates executeProtocol() with a token NOT in Axon's built-in list.
 * Aave on Base Sepolia uses its own test USDC (0xba50Cd2A...), not Circle's.
 * This shows how to work with arbitrary ERC-20 addresses.
 *
 * The vault is the depositor — aTokens (aUSDC) accrue in the vault,
 * and only the owner can withdraw. The bot never holds funds.
 *
 * Setup (one-time):
 *   1. Deploy vault on Base Sepolia
 *   2. Register bot with spending limits
 *   3. Fund vault with Aave test USDC (mint from Aave faucet)
 *
 * Usage:
 *   cp .env.example .env
 *   npm install
 *   npx tsx lend.ts supply          # supply USDC to Aave
 *   npx tsx lend.ts withdraw         # withdraw USDC from Aave
 *   npx tsx lend.ts balance          # check vault balances
 */

import { AxonClient, Chain } from '@axonfi/sdk';
import { encodeFunctionData, formatUnits } from 'viem';
import 'dotenv/config';

// ── Axon client ─────────────────────────────────────────────────────────────

const axon = new AxonClient({
  vaultAddress: process.env.AXON_VAULT_ADDRESS! as `0x${string}`,
  chainId: Number(process.env.AXON_CHAIN_ID ?? Chain.BaseSepolia),
  botPrivateKey: process.env.AXON_BOT_PRIVATE_KEY! as `0x${string}`,
});

// ── Aave V3 addresses (Base Sepolia) ────────────────────────────────────────
// Note: Aave uses its OWN test USDC, not Circle's USDC (0x036CbD53...).
// This is common in DeFi testnets — protocols deploy their own test tokens.

const AAVE_POOL = '0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27';
const AAVE_USDC = '0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f'; // Aave's test USDC (6 decimals)
const AAVE_aUSDC = '0x10F1A9D11CDf50041f3f8cB7191CBE2f31750ACC'; // aToken receipt

const USDC_DECIMALS = 6;
const SUPPLY_AMOUNT = Number(process.env.SUPPLY_AMOUNT ?? '100'); // 100 USDC default

// ── ABI fragments ───────────────────────────────────────────────────────────

const supplyAbi = [
  {
    name: 'supply',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'onBehalfOf', type: 'address' },
      { name: 'referralCode', type: 'uint16' },
    ],
    outputs: [],
  },
] as const;

const withdrawAbi = [
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'to', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const;

// ── Helpers ─────────────────────────────────────────────────────────────────

function toBaseUnits(amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** USDC_DECIMALS));
}

async function waitForResult(requestId: string, label: string) {
  for (let i = 0; i < 30; i++) {
    const result = await axon.pollExecute(requestId);
    if (result.status === 'approved' || result.status === 'rejected') return result;
    console.log(`  ${label} status: ${result.status}...`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('Timed out waiting for result');
}

// ── Commands ────────────────────────────────────────────────────────────────

async function cmdSupply() {
  const amount = toBaseUnits(SUPPLY_AMOUNT);
  console.log(`\nSupplying ${SUPPLY_AMOUNT} USDC to Aave V3...`);

  // Encode: pool.supply(AAVE_USDC, amount, vault, 0)
  // The vault supplies on its own behalf — aTokens accrue in the vault.
  const callData = encodeFunctionData({
    abi: supplyAbi,
    functionName: 'supply',
    args: [AAVE_USDC, amount, axon.vaultAddress as `0x${string}`, 0],
  });

  // executeProtocol() handles: approve USDC → call pool.supply() → revoke
  // We pass the raw token address since Aave USDC isn't in Axon's known tokens.
  const result = await axon.execute({
    protocol: AAVE_POOL,
    callData,
    token: AAVE_USDC, // raw address — not a known symbol
    amount, // raw base units (bigint)
    protocolName: 'Aave V3 Supply',
    memo: `Supply ${SUPPLY_AMOUNT} USDC to Aave`,
  });

  if (result.requestId && !result.txHash) {
    const final = await waitForResult(result.requestId, 'supply');
    printResult(final);
  } else {
    printResult(result);
  }
}

async function cmdWithdraw() {
  const amount = toBaseUnits(SUPPLY_AMOUNT);
  console.log(`\nWithdrawing ${SUPPLY_AMOUNT} USDC from Aave V3...`);

  // Encode: pool.withdraw(AAVE_USDC, amount, vault)
  // Withdraws to the vault itself — funds return to vault custody.
  const callData = encodeFunctionData({
    abi: withdrawAbi,
    functionName: 'withdraw',
    args: [AAVE_USDC, amount, axon.vaultAddress as `0x${string}`],
  });

  // For withdraw, no token approval is needed — Aave Pool burns aTokens
  // internally. When amount=0, the vault skips the approve → revoke cycle
  // and just calls the protocol directly. This is the pattern for any
  // protocol call that doesn't need the vault to approve token spending.
  const result = await axon.execute({
    protocol: AAVE_POOL,
    callData,
    token: AAVE_USDC, // required field, but amount=0 means no approval
    amount: 0n, // 0 = skip approve/revoke, just call the protocol
    protocolName: 'Aave V3 Withdraw',
    memo: `Withdraw ${SUPPLY_AMOUNT} USDC from Aave`,
  });

  if (result.requestId && !result.txHash) {
    const final = await waitForResult(result.requestId, 'withdraw');
    printResult(final);
  } else {
    printResult(result);
  }
}

async function cmdBalance() {
  const [usdc, aUsdc] = await Promise.all([axon.getBalance(AAVE_USDC), axon.getBalance(AAVE_aUSDC)]);

  console.log(`\nVault balances:`);
  console.log(`  USDC (Aave):  ${formatUnits(usdc, USDC_DECIMALS)}`);
  console.log(`  aUSDC:        ${formatUnits(aUsdc, USDC_DECIMALS)} (earning yield)`);
}

function printResult(result: { status: string; txHash?: string | null; reason?: string | null }) {
  console.log(`  Status: ${result.status}`);
  if (result.txHash) {
    console.log(`  TX: https://sepolia.basescan.org/tx/${result.txHash}`);
  }
  if (result.reason) {
    console.log(`  Reason: ${result.reason}`);
  }
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const USAGE = `
Aave V3 Lending — supply/withdraw USDC via Axon vault

Commands:
  supply      Supply USDC to Aave (earn yield)
  withdraw    Withdraw USDC from Aave
  balance     Show vault USDC + aUSDC balances
  help        Show this message

Examples:
  npx tsx lend.ts supply
  npx tsx lend.ts withdraw
  SUPPLY_AMOUNT=500 npx tsx lend.ts supply
`;

async function main() {
  const cmd = process.argv[2]?.toLowerCase();
  if (!cmd || cmd === 'help') {
    console.log(USAGE);
    return;
  }

  console.log(`Vault: ${axon.vaultAddress}`);
  console.log(`Bot:   ${axon.botAddress}`);
  console.log(`Chain: Base Sepolia`);

  if (cmd === 'supply') await cmdSupply();
  else if (cmd === 'withdraw') await cmdWithdraw();
  else if (cmd === 'balance') await cmdBalance();
  else {
    console.log(`Unknown command: ${cmd}`);
    console.log(USAGE);
  }
}

main().catch((err) => {
  console.error('Error:', err.message ?? err);
  process.exit(1);
});
