/**
 * WETH Wrapping — Wrap ETH to WETH via executeProtocol().
 *
 * Demonstrates the `value` field in ExecuteIntent, which forwards native ETH
 * to payable protocol functions. WETH.deposit() reads msg.value to determine
 * how much ETH to wrap — the bot signs the exact amount in the intent.
 *
 * The same pattern works for any payable function:
 *   - Lido submit() — staking ETH for stETH
 *   - Stargate/LayerZero send() — cross-chain message fees
 *   - NFT mints with ETH price
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
 *   npx tsx wrap.ts deposit    # wrap ETH → WETH via deposit() with value
 *   npx tsx wrap.ts balance    # check vault ETH + WETH balances
 */

import { AxonClient, Chain } from '@axonfi/sdk';
import { encodeFunctionData, createPublicClient, http, parseAbi, formatEther, parseEther } from 'viem';
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

// ── deposit: wrap ETH via WETH.deposit() with value ─────────────────────────

async function deposit() {
  const before = await getBalances();
  console.log(`\nBEFORE — ETH: ${formatEther(before.eth)}, WETH: ${formatEther(before.weth)}`);

  if (before.eth === 0n) {
    console.error('Vault has 0 ETH. Send some ETH to the vault first.');
    process.exit(1);
  }

  // Wrap a small amount (0.0005 ETH or half of balance if less)
  const wrapAmount = before.eth < parseEther('0.001') ? before.eth / 2n : parseEther('0.0005');

  // WETH.deposit() — payable, no args, wraps msg.value into WETH
  const callData = encodeFunctionData({
    abi: [{ type: 'function', name: 'deposit', inputs: [], outputs: [], stateMutability: 'payable' }],
    functionName: 'deposit',
  });

  console.log(`\nWrapping ${formatEther(wrapAmount)} ETH → WETH via WETH.deposit()...`);
  console.log('The bot signs the ETH amount in the intent `value` field.');
  console.log('The vault forwards it as msg.value to the WETH contract.\n');

  try {
    const result = await axon.execute({
      protocol: WETH,
      callData,
      tokens: [WETH],
      amounts: [0], // no token approval needed — we're sending ETH
      value: wrapAmount, // native ETH to forward
    });

    console.log('Result:', result);

    const after = await getBalances();
    console.log(`\nAFTER  — ETH: ${formatEther(after.eth)}, WETH: ${formatEther(after.weth)}`);
    console.log(`Wrapped ${formatEther(after.weth - before.weth)} ETH → WETH`);
  } catch (err) {
    console.error('Error:', (err as Error).message);
    console.log('\nMake sure WETH is approved as a protocol on the vault.');
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
  case 'balance':
    await balance();
    break;
  default:
    console.log('Usage: npx tsx wrap.ts <deposit|balance>');
    console.log('  deposit — wrap ETH → WETH via WETH.deposit() with value');
    console.log('  balance — check vault ETH + WETH balances');
}
