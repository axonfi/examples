/**
 * WETH Wrapping — Wrap ETH to WETH via executeProtocol().
 *
 * STATUS: FAILS on vault VERSION 3 (msg.value limitation)
 *
 * WETH.deposit() is a payable function that wraps msg.value ETH into WETH.
 * But executeProtocol() calls `protocol.call(callData)` with msg.value = 0,
 * so deposit() succeeds but wraps 0 ETH — a silent no-op.
 *
 * The same limitation blocks:
 *   - Lido submit() — staking ETH for stETH
 *   - GMX sendWnt() — execution fees (workaround: use sendTokens(WETH))
 *   - Stargate/LayerZero send() — cross-chain message fees
 *   - Liquity openTrove() — ETH-collateral CDPs
 *
 * Workaround: swap ETH → WETH via executeSwap() through a DEX.
 * This costs ~0.3% more (DEX fee) but works with current contracts.
 *
 * Setup:
 *   1. Deploy vault on Base Sepolia
 *   2. Register bot
 *   3. Approve WETH contract as protocol on vault
 *   4. Fund vault with ETH (send ETH directly to vault address)
 *
 * Usage:
 *   cp .env.example .env
 *   npm install
 *   npx tsx wrap.ts deposit    # try to wrap ETH → WETH (will fail: 0 wrapped)
 *   npx tsx wrap.ts workaround # swap ETH → WETH via DEX (works)
 *   npx tsx wrap.ts balance    # check vault ETH + WETH balances
 */

import { AxonClient, Chain, Token } from '@axonfi/sdk';
import { encodeFunctionData, createPublicClient, http, parseAbi, formatEther } from 'viem';
import { baseSepolia } from 'viem/chains';
import 'dotenv/config';

const axon = new AxonClient({
  vaultAddress: process.env.AXON_VAULT_ADDRESS! as `0x${string}`,
  chainId: Number(process.env.AXON_CHAIN_ID ?? Chain.BaseSepolia),
  botPrivateKey: process.env.AXON_BOT_PRIVATE_KEY! as `0x${string}`,
});

// WETH on Base Sepolia (OP Stack canonical)
const WETH = '0x4200000000000000000000000000000000000006' as `0x${string}`;

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.RPC_URL ?? 'https://sepolia.base.org'),
});

const ERC20_ABI = parseAbi(['function balanceOf(address) view returns (uint256)']);

async function getBalances() {
  const vault = axon.vaultAddress as `0x${string}`;
  const [ethBal, wethBal] = await Promise.all([
    client.getBalance({ address: vault }),
    client.readContract({ address: WETH, abi: ERC20_ABI, functionName: 'balanceOf', args: [vault] }),
  ]);
  return { eth: ethBal, weth: wethBal };
}

// ── deposit: try to wrap ETH via executeProtocol (will fail) ─────────────────

async function deposit() {
  const before = await getBalances();
  console.log(`\nBEFORE — ETH: ${formatEther(before.eth)}, WETH: ${formatEther(before.weth)}`);

  if (before.eth === 0n) {
    console.error('Vault has 0 ETH. Send some ETH to the vault first.');
    process.exit(1);
  }

  // WETH.deposit() — a payable function with no args, uses msg.value
  const callData = encodeFunctionData({
    abi: [{ type: 'function', name: 'deposit', inputs: [], outputs: [], stateMutability: 'payable' }],
    functionName: 'deposit',
  });

  console.log('\nCalling WETH.deposit() via executeProtocol()...');
  console.log('deposit() needs msg.value to know how much ETH to wrap.');
  console.log('executeProtocol() sends msg.value = 0, so this will wrap nothing.\n');

  try {
    const result = await axon.execute({
      protocol: WETH,
      callData,
      token: WETH, // doesn't matter, amount is 0
      amount: 0,
    });

    console.log('Result:', result);

    const after = await getBalances();
    console.log(`\nAFTER  — ETH: ${formatEther(after.eth)}, WETH: ${formatEther(after.weth)}`);

    const wrapped = after.weth - before.weth;
    if (wrapped === 0n) {
      console.log('\n=== CONFIRMED: 0 ETH was wrapped ===');
      console.log('deposit() succeeded on-chain but wrapped nothing (msg.value was 0).');
      console.log('This is the msg.value limitation in executeProtocol().');
      console.log('Use `npx tsx wrap.ts workaround` to swap via DEX instead.');
    } else {
      console.log(`\nWrapped ${formatEther(wrapped)} ETH → WETH`);
    }
  } catch (err) {
    console.error('Error:', (err as Error).message);
    console.log('\nIf rejected: make sure WETH is approved as a protocol on the vault.');
  }
}

// ── workaround: swap ETH → WETH via DEX (works) ─────────────────────────────

async function workaround() {
  const before = await getBalances();
  console.log(`\nBEFORE — ETH: ${formatEther(before.eth)}, WETH: ${formatEther(before.weth)}`);

  if (before.eth === 0n) {
    console.error('Vault has 0 ETH. Send some ETH to the vault first.');
    process.exit(1);
  }

  const swapAmount = before.eth < 500000000000000n ? before.eth / 2n : 500000000000000n;

  console.log(`\nSwapping ${formatEther(swapAmount)} ETH → WETH via executeSwap()...`);
  console.log('This routes through an approved DEX router — no msg.value needed.\n');

  try {
    const result = await axon.swap({
      toToken: Token.WETH,
      minToAmount: swapAmount.toString(),
    });

    console.log('Result:', result);

    const after = await getBalances();
    console.log(`\nAFTER  — ETH: ${formatEther(after.eth)}, WETH: ${formatEther(after.weth)}`);
    console.log(`Gained ${formatEther(after.weth - before.weth)} WETH via DEX swap.`);
  } catch (err) {
    console.error('Error:', (err as Error).message);
  }
}

// ── balance ──────────────────────────────────────────────────────────────────

async function balance() {
  const b = await getBalances();
  console.log(`Vault: ${axon.vaultAddress}`);
  console.log(`  ETH:  ${formatEther(b.eth)}`);
  console.log(`  WETH: ${formatEther(b.weth)}`);
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const command = process.argv[2];
switch (command) {
  case 'deposit':
    await deposit();
    break;
  case 'workaround':
    await workaround();
    break;
  case 'balance':
    await balance();
    break;
  default:
    console.log('Usage: npx tsx wrap.ts <deposit|workaround|balance>');
    console.log('  deposit    — try wrapping ETH via WETH.deposit() (fails: msg.value=0)');
    console.log('  workaround — swap ETH→WETH via DEX (works)');
    console.log('  balance    — check vault ETH + WETH balances');
}
