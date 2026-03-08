/**
 * Uniswap V3 Liquidity Providing — mint and remove LP positions via Axon vault.
 *
 * Demonstrates the multi-token approval pattern with execute().
 * Uniswap V3's NonfungiblePositionManager.mint() needs TWO token approvals
 * (USDC + WETH), but execute() only auto-approves ONE per call.
 *
 * Solution — two execute() calls:
 *   1. Persistent WETH approval: execute(protocol=WETH, amounts=[0], callData=approve(NPM, max))
 *      amounts=[0] tells the vault to skip its approve/revoke cycle, so the
 *      approval set by the calldata persists after the call.
 *   2. Mint LP position: execute(protocol=NPM, tokens=[USDC], amounts=[X], callData=mint(...))
 *      Vault auto-approves USDC to NPM, NPM pulls USDC + WETH, vault revokes USDC.
 *      WETH uses the persistent approval from step 1.
 *
 * The vault holds the LP NFT — only the owner can remove liquidity.
 *
 * Setup (one-time):
 *   1. Deploy vault on Base Sepolia
 *   2. Register bot (maxPerTxAmount=0 for non-oracle tokens)
 *   3. Fund vault with USDC + WETH
 *   4. Approve NonfungiblePositionManager + WETH as protocols:
 *      cast send <vault> "approveProtocol(address)" 0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2
 *      cast send <vault> "approveProtocol(address)" 0x4200000000000000000000000000000000000006
 *
 * Usage:
 *   npm install
 *   cp .env.example .env
 *   npx tsx lp.ts mint              # provide liquidity (USDC + WETH)
 *   npx tsx lp.ts remove <tokenId>  # remove liquidity + collect tokens
 *   npx tsx lp.ts positions         # list vault's LP positions
 *   npx tsx lp.ts balance           # check vault balances
 */

import { AxonClient, Chain } from '@axonfi/sdk';
import { createPublicClient, encodeFunctionData, formatUnits, http, maxUint256, parseUnits } from 'viem';
import { baseSepolia } from 'viem/chains';
import 'dotenv/config';

// ── Axon client ─────────────────────────────────────────────────────────────

const axon = new AxonClient({
  vaultAddress: process.env.AXON_VAULT_ADDRESS! as `0x${string}`,
  chainId: Number(process.env.AXON_CHAIN_ID ?? Chain.BaseSepolia),
  botPrivateKey: process.env.AXON_BOT_PRIVATE_KEY! as `0x${string}`,
});

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.RPC_URL ?? 'https://sepolia.base.org'),
});

// ── Contract addresses (Base Sepolia) ──────────────────────────────────────

const NPM = '0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2' as const; // NonfungiblePositionManager
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;
const WETH = '0x4200000000000000000000000000000000000006' as const;

const FEE_TIER = 3000; // 0.3% pool
const TICK_LOWER = -887220; // full-range (divisible by tick spacing 60)
const TICK_UPPER = 887220;
const MAX_UINT128 = 2n ** 128n - 1n;

const USDC_AMOUNT = Number(process.env.USDC_AMOUNT ?? '0.5');
const WETH_AMOUNT = Number(process.env.WETH_AMOUNT ?? '0.0001');

// ── ABI fragments ───────────────────────────────────────────────────────────

const approveAbi = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const;

const mintAbi = [
  {
    name: 'mint',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'token0', type: 'address' },
          { name: 'token1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickLower', type: 'int24' },
          { name: 'tickUpper', type: 'int24' },
          { name: 'amount0Desired', type: 'uint256' },
          { name: 'amount1Desired', type: 'uint256' },
          { name: 'amount0Min', type: 'uint256' },
          { name: 'amount1Min', type: 'uint256' },
          { name: 'recipient', type: 'address' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
    ],
    outputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'liquidity', type: 'uint128' },
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
  },
] as const;

const decreaseLiquidityAbi = [
  {
    name: 'decreaseLiquidity',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenId', type: 'uint256' },
          { name: 'liquidity', type: 'uint128' },
          { name: 'amount0Min', type: 'uint256' },
          { name: 'amount1Min', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
    ],
    outputs: [
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
  },
] as const;

const collectAbi = [
  {
    name: 'collect',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenId', type: 'uint256' },
          { name: 'recipient', type: 'address' },
          { name: 'amount0Max', type: 'uint128' },
          { name: 'amount1Max', type: 'uint128' },
        ],
      },
    ],
    outputs: [
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
  },
] as const;

const npmReadAbi = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'tokenOfOwnerByIndex',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'index', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'positions',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [
      { name: 'nonce', type: 'uint96' },
      { name: 'operator', type: 'address' },
      { name: 'token0', type: 'address' },
      { name: 'token1', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'tickLower', type: 'int24' },
      { name: 'tickUpper', type: 'int24' },
      { name: 'liquidity', type: 'uint128' },
      { name: 'feeGrowthInside0LastX128', type: 'uint256' },
      { name: 'feeGrowthInside1LastX128', type: 'uint256' },
      { name: 'tokensOwed0', type: 'uint128' },
      { name: 'tokensOwed1', type: 'uint128' },
    ],
  },
] as const;

// ── Helpers ─────────────────────────────────────────────────────────────────

async function waitForResult(requestId: string, label: string) {
  for (let i = 0; i < 30; i++) {
    const result = await axon.pollExecute(requestId);
    if (result.status === 'approved' || result.status === 'rejected') return result;
    console.log(`  ${label} status: ${result.status}...`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('Timed out waiting for result');
}

function printResult(result: { status: string; txHash?: string | null; reason?: string | null }) {
  console.log(`  Status: ${result.status}`);
  if (result.txHash) console.log(`  TX: https://sepolia.basescan.org/tx/${result.txHash}`);
  if (result.reason) console.log(`  Reason: ${result.reason}`);
}

// ── Commands ────────────────────────────────────────────────────────────────

async function cmdMint() {
  const usdcAmount = parseUnits(USDC_AMOUNT.toString(), 6);
  const wethAmount = parseUnits(WETH_AMOUNT.toString(), 18);
  const vault = axon.vaultAddress as `0x${string}`;

  // ── Step 1: Persistent WETH approval ──
  console.log(`\n-- Step 1: Persistent WETH approval to NonfungiblePositionManager --`);
  console.log(`  amount=0 means vault skips approve/revoke — the calldata's approval persists.\n`);

  const approveCallData = encodeFunctionData({
    abi: approveAbi,
    functionName: 'approve',
    args: [NPM, maxUint256],
  });

  let result = await axon.execute({
    protocol: WETH,
    callData: approveCallData,
    tokens: [WETH],
    amounts: [0n], // skip vault's approve/revoke cycle
    protocolName: 'WETH Approval',
    memo: 'Persistent WETH approval to NPM',
  });
  if (result.requestId && !result.txHash) {
    result = await waitForResult(result.requestId, 'approval');
  }
  printResult(result);
  if (result.status !== 'approved') return;

  // ── Step 2: Mint LP position ──
  console.log(`\n-- Step 2: Mint LP position --`);
  console.log(`  ${USDC_AMOUNT} USDC + ${WETH_AMOUNT} WETH -> full-range liquidity\n`);

  // Uniswap requires token0 < token1 by address
  const usdcLower = USDC.toLowerCase();
  const wethLower = WETH.toLowerCase();
  const [token0, token1, amount0, amount1] =
    usdcLower < wethLower ? [USDC, WETH, usdcAmount, wethAmount] : [WETH, USDC, wethAmount, usdcAmount];

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);

  const mintCallData = encodeFunctionData({
    abi: mintAbi,
    functionName: 'mint',
    args: [
      {
        token0,
        token1,
        fee: FEE_TIER,
        tickLower: TICK_LOWER,
        tickUpper: TICK_UPPER,
        amount0Desired: amount0,
        amount1Desired: amount1,
        amount0Min: 0n, // accept any (testnet only)
        amount1Min: 0n,
        recipient: vault, // LP NFT goes to vault
        deadline,
      },
    ],
  });

  // Vault auto-approves USDC to NPM, NPM pulls USDC + WETH, vault revokes USDC
  result = await axon.execute({
    protocol: NPM,
    callData: mintCallData,
    tokens: [USDC],
    amounts: [usdcAmount],
    protocolName: 'Uniswap V3 Mint LP',
    memo: `Mint ${USDC_AMOUNT} USDC + ${WETH_AMOUNT} WETH LP`,
  });
  if (result.requestId && !result.txHash) {
    result = await waitForResult(result.requestId, 'mint');
  }
  printResult(result);
}

async function cmdRemove(tokenId: bigint) {
  console.log(`\nRemoving liquidity from NFT #${tokenId}...`);
  const vault = axon.vaultAddress as `0x${string}`;

  // Read position to get liquidity
  const pos = await publicClient.readContract({
    address: NPM,
    abi: npmReadAbi,
    functionName: 'positions',
    args: [tokenId],
  });
  const liquidity = pos[7];

  if (liquidity === 0n) {
    console.log(`  Position #${tokenId} has no liquidity to remove.`);
    return;
  }
  console.log(`  Liquidity: ${liquidity}`);

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);

  // Step 1: decreaseLiquidity
  console.log(`\n-- Step 1: Decrease liquidity --`);
  const decreaseCallData = encodeFunctionData({
    abi: decreaseLiquidityAbi,
    functionName: 'decreaseLiquidity',
    args: [{ tokenId, liquidity, amount0Min: 0n, amount1Min: 0n, deadline }],
  });

  let result = await axon.execute({
    protocol: NPM,
    callData: decreaseCallData,
    tokens: [USDC],
    amounts: [0n],
    protocolName: 'Uniswap V3 Decrease',
    memo: `Decrease liquidity NFT #${tokenId}`,
  });
  if (result.requestId && !result.txHash) {
    result = await waitForResult(result.requestId, 'decrease');
  }
  printResult(result);
  if (result.status !== 'approved') return;

  // Step 2: collect
  console.log(`\n-- Step 2: Collect tokens --`);
  const collectCallData = encodeFunctionData({
    abi: collectAbi,
    functionName: 'collect',
    args: [{ tokenId, recipient: vault, amount0Max: MAX_UINT128, amount1Max: MAX_UINT128 }],
  });

  result = await axon.execute({
    protocol: NPM,
    callData: collectCallData,
    tokens: [USDC],
    amounts: [0n],
    protocolName: 'Uniswap V3 Collect',
    memo: `Collect tokens NFT #${tokenId}`,
  });
  if (result.requestId && !result.txHash) {
    result = await waitForResult(result.requestId, 'collect');
  }
  printResult(result);
}

async function cmdPositions() {
  const vault = axon.vaultAddress as `0x${string}`;
  const count = await publicClient.readContract({
    address: NPM,
    abi: npmReadAbi,
    functionName: 'balanceOf',
    args: [vault],
  });

  console.log(`\nVault LP positions: ${count}`);
  for (let i = 0n; i < count; i++) {
    const tokenId = await publicClient.readContract({
      address: NPM,
      abi: npmReadAbi,
      functionName: 'tokenOfOwnerByIndex',
      args: [vault, i],
    });
    const pos = await publicClient.readContract({
      address: NPM,
      abi: npmReadAbi,
      functionName: 'positions',
      args: [tokenId],
    });
    const t0 = pos[2].toLowerCase() === USDC.toLowerCase() ? 'USDC' : 'WETH';
    const t1 = pos[3].toLowerCase() === USDC.toLowerCase() ? 'USDC' : 'WETH';
    const feePct = pos[4] / 10000;
    console.log(`  #${tokenId}: ${t0}/${t1} ${feePct}% | liquidity: ${pos[7]} | ticks: [${pos[5]}, ${pos[6]}]`);
  }
}

async function cmdBalance() {
  const [usdcBal, wethBal] = await Promise.all([axon.getBalance(USDC), axon.getBalance(WETH)]);
  console.log(`\nVault balances:`);
  console.log(`  USDC: ${formatUnits(usdcBal, 6)}`);
  console.log(`  WETH: ${formatUnits(wethBal, 18)}`);
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const USAGE = `
Uniswap V3 LP — provide liquidity via Axon vault

Commands:
  mint                Provide USDC + WETH liquidity (full range)
  remove <tokenId>    Remove liquidity + collect tokens
  positions           List vault's LP positions
  balance             Show vault USDC + WETH balances
  help                Show this message

Examples:
  npx tsx lp.ts mint
  npx tsx lp.ts positions
  npx tsx lp.ts remove 12345
  USDC_AMOUNT=2 WETH_AMOUNT=0.001 npx tsx lp.ts mint
`;

async function main() {
  const cmd = process.argv[2]?.toLowerCase() ?? 'help';
  if (cmd === 'help') {
    console.log(USAGE);
    return;
  }

  console.log(`Vault: ${axon.vaultAddress}`);
  console.log(`Bot:   ${axon.botAddress}`);
  console.log(`Chain: Base Sepolia`);

  if (cmd === 'mint') await cmdMint();
  else if (cmd === 'remove') {
    const tokenId = process.argv[3];
    if (!tokenId) {
      console.log('Usage: npx tsx lp.ts remove <tokenId>');
      return;
    }
    await cmdRemove(BigInt(tokenId));
  } else if (cmd === 'positions') await cmdPositions();
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
