/**
 * Lido Staking — Stake ETH for stETH via executeProtocol().
 *
 * STATUS: FAILS on vault VERSION 3 (msg.value limitation)
 *
 * Lido's submit() is a payable function: `lido.submit{value: X}(referral)`
 * It reads msg.value to know how much ETH to stake. Since executeProtocol()
 * sends msg.value = 0, the call stakes nothing.
 *
 * NOTE: Lido staking (submit()) only exists on Ethereum L1.
 * On L2s like Base/Arbitrum, you get wstETH by swapping, not staking.
 *
 * Workaround (works today on Base/Arbitrum):
 *   Swap ETH → wstETH via executeSwap() through a DEX.
 *   wstETH is the wrapped, non-rebasing version of stETH — preferred on L2s.
 *   Cost: ~0.3% DEX fee vs free Lido direct staking.
 *
 * When vault VERSION 4 adds msg.value support to executeProtocol(),
 * this example will work for direct L1 Lido staking.
 *
 * Setup:
 *   1. Deploy vault on Base (mainnet or Sepolia)
 *   2. Register bot
 *   3. Fund vault with ETH
 *
 * Usage:
 *   cp .env.example .env
 *   npm install
 *   npx tsx stake.ts direct     # try direct Lido submit() — FAILS (msg.value)
 *   npx tsx stake.ts swap       # swap ETH → wstETH via DEX — WORKS
 *   npx tsx stake.ts balance    # check vault balances
 */

import { AxonClient, Chain } from '@axonfi/sdk';
import { encodeFunctionData, createPublicClient, http, parseAbi, formatEther } from 'viem';
import { base } from 'viem/chains';
import 'dotenv/config';

const chainId = Number(process.env.AXON_CHAIN_ID ?? Chain.Base);

const axon = new AxonClient({
  vaultAddress: process.env.AXON_VAULT_ADDRESS! as `0x${string}`,
  chainId,
  botPrivateKey: process.env.AXON_BOT_PRIVATE_KEY! as `0x${string}`,
});

// wstETH on Base mainnet
const WSTETH = '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452' as `0x${string}`;

// Lido stETH on Ethereum L1 (for reference — not available on L2s)
const LIDO_L1 = '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84' as `0x${string}`;

const client = createPublicClient({
  chain: base,
  transport: http(process.env.RPC_URL),
});

const ERC20_ABI = parseAbi(['function balanceOf(address) view returns (uint256)']);

async function getBalances() {
  const vault = axon.vaultAddress as `0x${string}`;
  const [ethBal, wstethBal] = await Promise.all([
    client.getBalance({ address: vault }),
    client.readContract({ address: WSTETH, abi: ERC20_ABI, functionName: 'balanceOf', args: [vault] }),
  ]);
  return { eth: ethBal, wsteth: wstethBal };
}

// ── direct: try Lido submit() via executeProtocol (will fail) ────────────────

async function direct() {
  console.log('\n=== Direct Lido Staking via executeProtocol() ===\n');
  console.log('Lido submit() is payable — it uses msg.value to determine stake amount.');
  console.log('executeProtocol() calls protocol.call(callData) with msg.value = 0.');
  console.log('Result: the call succeeds but stakes 0 ETH.\n');

  // Lido submit(address _referral) — payable
  const callData = encodeFunctionData({
    abi: [
      {
        type: 'function',
        name: 'submit',
        inputs: [{ name: '_referral', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }],
        stateMutability: 'payable',
      },
    ],
    functionName: 'submit',
    args: ['0x0000000000000000000000000000000000000000' as `0x${string}`], // no referral
  });

  console.log('Encoded callData:', callData);
  console.log('\nThis would need to be called as:');
  console.log('  lido.submit{value: 1 ether}(address(0))');
  console.log('\nBut executeProtocol() does:');
  console.log('  lido.call(callData)  // msg.value = 0');
  console.log('\nOn Ethereum L1, this would stake 0 ETH.');
  console.log('On L2s, Lido submit() is not available at all.');
  console.log('\nUse `npx tsx stake.ts swap` for the working L2 workaround.');
}

// ── swap: ETH → wstETH via DEX (works on L2) ────────────────────────────────

async function swap() {
  const before = await getBalances();
  console.log(`\nBEFORE — ETH: ${formatEther(before.eth)}, wstETH: ${formatEther(before.wsteth)}`);

  if (before.eth === 0n) {
    console.error('Vault has 0 ETH. Send some ETH to the vault first.');
    process.exit(1);
  }

  // Swap a small amount of ETH → wstETH via DEX
  const swapAmount = before.eth < 500000000000000n ? before.eth / 2n : 500000000000000n;
  console.log(`\nSwapping ${formatEther(swapAmount)} ETH → wstETH via executeSwap()...`);

  try {
    const result = await axon.swap({
      toToken: WSTETH,
      minToAmount: '1', // any amount — relayer handles slippage
    });

    console.log('Result:', result);

    const after = await getBalances();
    console.log(`\nAFTER  — ETH: ${formatEther(after.eth)}, wstETH: ${formatEther(after.wsteth)}`);
    console.log(`Gained ${formatEther(after.wsteth - before.wsteth)} wstETH via DEX swap.`);
    console.log('\nwstETH accrues staking rewards (non-rebasing). Same yield as stETH.');
  } catch (err) {
    console.error('Error:', (err as Error).message);
  }
}

// ── balance ──────────────────────────────────────────────────────────────────

async function balance() {
  const b = await getBalances();
  console.log(`Vault: ${axon.vaultAddress}`);
  console.log(`  ETH:    ${formatEther(b.eth)}`);
  console.log(`  wstETH: ${formatEther(b.wsteth)}`);
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const command = process.argv[2];
switch (command) {
  case 'direct':
    await direct();
    break;
  case 'swap':
    await swap();
    break;
  case 'balance':
    await balance();
    break;
  default:
    console.log('Usage: npx tsx stake.ts <direct|swap|balance>');
    console.log('  direct  — show why Lido submit() fails (msg.value=0)');
    console.log('  swap    — swap ETH→wstETH via DEX (works on L2s)');
    console.log('  balance — check vault ETH + wstETH balances');
}
