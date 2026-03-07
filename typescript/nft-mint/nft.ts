/**
 * NFT Minting via Axon Vault — mint ERC-721 NFTs into your vault using executeProtocol().
 *
 * Demonstrates:
 *   - Bot signing an ExecuteIntent to call an NFT contract's mint()
 *   - Vault receives the NFT via onERC721Received (ERC-721 receiver support)
 *   - Querying NFTs owned by the vault
 *
 * The vault acts as the NFT holder — only the owner can withdraw NFTs
 * using withdrawERC721().
 *
 * Setup (one-time):
 *   1. Deploy vault on Base Sepolia (must be the NFT-compatible version)
 *   2. Register bot (maxPerTxAmount=0 for free mints)
 *   3. Approve the NFT contract as a protocol:
 *      cast send <vault> "approveProtocol(address)" <nft-contract>
 *
 * Usage:
 *   npm install
 *   cp .env.example .env   # fill in your vault + bot key
 *   npx tsx nft.ts mint    # mint a new NFT to the vault
 *   npx tsx nft.ts list    # list NFTs owned by the vault
 *   npx tsx nft.ts info <tokenId>  # show NFT details
 */

import { AxonClient, Chain } from '@axonfi/sdk';
import { createPublicClient, encodeFunctionData, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import 'dotenv/config';

// ── Axon client ─────────────────────────────────────────────────────────────

const axon = new AxonClient({
  vaultAddress: process.env.AXON_VAULT_ADDRESS!,
  chainId: Number(process.env.AXON_CHAIN_ID ?? Chain.BaseSepolia),
  botPrivateKey: process.env.AXON_BOT_PRIVATE_KEY! as `0x${string}`,
});

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.RPC_URL ?? 'https://sepolia.base.org'),
});

const NFT_CONTRACT = (process.env.NFT_CONTRACT ?? '0x315149090ed5823598220E9bF76dE41278f062Fb') as `0x${string}`;

// ── ABI fragments ───────────────────────────────────────────────────────────

const mintAbi = [
  {
    name: 'mint',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'to', type: 'address' }],
    outputs: [{ name: 'tokenId', type: 'uint256' }],
  },
] as const;

const erc721ReadAbi = [
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
    name: 'ownerOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ type: 'address' }],
  },
  {
    name: 'name',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
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
  const vault = axon.vaultAddress as `0x${string}`;

  console.log(`\n-- Minting NFT to vault --`);
  console.log(`  NFT contract: ${NFT_CONTRACT}`);
  console.log(`  Recipient: ${vault} (the vault)\n`);

  // Encode mint(vault) — the NFT is minted directly to the vault
  const callData = encodeFunctionData({
    abi: mintAbi,
    functionName: 'mint',
    args: [vault],
  });

  // amount=0 because mint is free (no token transfer needed)
  let result = await axon.execute({
    protocol: NFT_CONTRACT,
    callData,
    token: NFT_CONTRACT, // placeholder — no actual token approval needed
    amount: 0n,
    protocolName: 'TestNFT Mint',
    memo: 'Mint test NFT to vault',
  });

  if (result.requestId && !result.txHash) {
    result = await waitForResult(result.requestId, 'mint');
  }
  printResult(result);

  if (result.status === 'approved') {
    // Show updated NFT count
    const count = await publicClient.readContract({
      address: NFT_CONTRACT,
      abi: erc721ReadAbi,
      functionName: 'balanceOf',
      args: [vault],
    });
    console.log(`\n  Vault now holds ${count} NFT(s) from this collection`);
  }
}

async function cmdList() {
  const vault = axon.vaultAddress as `0x${string}`;

  const [name, symbol, count] = await Promise.all([
    publicClient.readContract({ address: NFT_CONTRACT, abi: erc721ReadAbi, functionName: 'name' }),
    publicClient.readContract({ address: NFT_CONTRACT, abi: erc721ReadAbi, functionName: 'symbol' }),
    publicClient.readContract({ address: NFT_CONTRACT, abi: erc721ReadAbi, functionName: 'balanceOf', args: [vault] }),
  ]);

  console.log(`\n${name} (${symbol}) — ${NFT_CONTRACT}`);
  console.log(`Vault holds ${count} NFT(s):\n`);

  for (let i = 0n; i < count; i++) {
    try {
      const tokenId = await publicClient.readContract({
        address: NFT_CONTRACT,
        abi: erc721ReadAbi,
        functionName: 'tokenOfOwnerByIndex',
        args: [vault, i],
      });
      console.log(`  Token #${tokenId}`);
    } catch {
      // tokenOfOwnerByIndex may not be supported — fall back
      console.log(`  (index ${i} — tokenOfOwnerByIndex not supported)`);
      break;
    }
  }
}

async function cmdInfo(tokenId: bigint) {
  const owner = await publicClient.readContract({
    address: NFT_CONTRACT,
    abi: erc721ReadAbi,
    functionName: 'ownerOf',
    args: [tokenId],
  });
  const name = await publicClient.readContract({ address: NFT_CONTRACT, abi: erc721ReadAbi, functionName: 'name' });

  console.log(`\nNFT #${tokenId} — ${name}`);
  console.log(`  Contract: ${NFT_CONTRACT}`);
  console.log(`  Owner:    ${owner}`);
  console.log(`  Is vault: ${owner.toLowerCase() === axon.vaultAddress.toLowerCase()}`);
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const USAGE = `
NFT Mint — mint ERC-721 NFTs into your Axon vault

Commands:
  mint              Mint a new NFT to the vault
  list              List NFTs owned by the vault
  info <tokenId>    Show details for a specific NFT
  help              Show this message

Examples:
  npx tsx nft.ts mint
  npx tsx nft.ts list
  npx tsx nft.ts info 0
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
  else if (cmd === 'list') await cmdList();
  else if (cmd === 'info') {
    const tokenId = process.argv[3];
    if (!tokenId) {
      console.log('Usage: npx tsx nft.ts info <tokenId>');
      return;
    }
    await cmdInfo(BigInt(tokenId));
  } else {
    console.log(`Unknown command: ${cmd}`);
    console.log(USAGE);
  }
}

main().catch((err) => {
  console.error('Error:', err.message ?? err);
  process.exit(1);
});
