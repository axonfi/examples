/**
 * OpenSea NFT Buy Bot — buy NFTs from OpenSea into your Axon vault.
 *
 * Demonstrates:
 *   - Fetching listings from the OpenSea API
 *   - Getting fulfillment calldata for Seaport orders
 *   - Buying NFTs via executeProtocol() (vault receives the NFT)
 *   - WETH approval flow for Seaport payments
 *
 * The vault acts as the buyer and NFT holder. Only the owner can
 * withdraw NFTs using withdrawERC721() / withdrawERC1155().
 *
 * Setup (one-time):
 *   1. Deploy vault and register bot
 *   2. Approve Seaport as a protocol:
 *      cast send <vault> "approveProtocol(address)" 0x0000000000000068F116a894984e2DB1123eB395
 *   3. Fund vault with WETH (most NFT listings are in WETH)
 *   4. Get an OpenSea API key: https://docs.opensea.io/reference/api-keys
 *
 * Usage:
 *   npx tsx buy.ts listings <collection-slug>  — browse floor listings
 *   npx tsx buy.ts buy <collection-slug>        — buy the cheapest listing
 *   npx tsx buy.ts collection <collection-slug> — show collection info
 */

import { AxonClient, Chain } from '@axonfi/sdk';
import {
  createPublicClient,
  encodeFunctionData,
  http,
  parseAbi,
  type Address,
  type Hex,
  formatEther,
} from 'viem';
import { baseSepolia, base } from 'viem/chains';
import 'dotenv/config';

// ── Config ──────────────────────────────────────────────────────────────────

const chainId = Number(process.env.AXON_CHAIN_ID ?? Chain.BaseSepolia);
const isTestnet = chainId === Chain.BaseSepolia;
const chain = isTestnet ? baseSepolia : base;
const rpcUrl = process.env.RPC_URL ?? (isTestnet ? 'https://sepolia.base.org' : 'https://mainnet.base.org');
const openSeaChain = isTestnet ? 'base_sepolia' : 'base';
const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY;

if (!OPENSEA_API_KEY) {
  console.error('Error: OPENSEA_API_KEY is required. Get one at https://docs.opensea.io/reference/api-keys');
  process.exit(1);
}

// Seaport 1.6 — same address on all EVM chains
const SEAPORT = '0x0000000000000068F116a894984e2DB1123eB395' as Address;

// WETH addresses
const WETH: Record<number, Address> = {
  [Chain.BaseSepolia]: '0x4200000000000000000000000000000000000006',
  [Chain.Base]: '0x4200000000000000000000000000000000000006',
};

const axon = new AxonClient({
  vaultAddress: process.env.AXON_VAULT_ADDRESS!,
  chainId,
  botPrivateKey: process.env.AXON_BOT_PRIVATE_KEY! as `0x${string}`,
  relayerUrl: process.env.AXON_RELAYER_URL,
});

const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

// ── OpenSea API helpers ─────────────────────────────────────────────────────

const OPENSEA_BASE = 'https://api.opensea.io';

interface OpenSeaListing {
  order_hash: string;
  protocol_address: string;
  current_price: string; // wei
  maker: { address: string };
  taker: { address: string } | null;
  protocol_data: {
    parameters: {
      offer: Array<{
        itemType: number;
        token: string;
        identifierOrCriteria: string;
      }>;
      consideration: Array<{
        itemType: number;
        token: string;
        amount: string;
        recipient: string;
      }>;
    };
  };
}

interface OpenSeaCollection {
  collection: string;
  name: string;
  description: string;
  total_supply: number;
  contracts: Array<{ address: string; chain: string }>;
}

async function openSeaFetch(path: string): Promise<any> {
  const url = `${OPENSEA_BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'X-API-KEY': OPENSEA_API_KEY!,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenSea API ${res.status}: ${text}`);
  }
  return res.json();
}

async function getListings(collectionSlug: string, limit = 5): Promise<OpenSeaListing[]> {
  const data = await openSeaFetch(
    `/api/v2/orders/${openSeaChain}/seaport/listings?collection_slug=${collectionSlug}&order_by=eth_price&limit=${limit}`,
  );
  return data.orders ?? [];
}

async function getCollectionInfo(slug: string): Promise<OpenSeaCollection> {
  return openSeaFetch(`/api/v2/collections/${slug}`);
}

async function getFulfillmentData(orderHash: string, fulfillerAddress: string) {
  const res = await fetch(`${OPENSEA_BASE}/api/v2/listings/fulfillment`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-API-KEY': OPENSEA_API_KEY!,
    },
    body: JSON.stringify({
      listing: { hash: orderHash, chain: openSeaChain, protocol_address: SEAPORT },
      fulfiller: { address: fulfillerAddress },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Fulfillment API ${res.status}: ${text}`);
  }
  return res.json();
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function waitForResult(requestId: string, label: string) {
  for (let i = 0; i < 60; i++) {
    const result = await axon.pollExecute(requestId);
    if (result.status === 'approved') return result;
    if (result.status === 'rejected') {
      console.log(`  ${label} REJECTED: ${result.reason}`);
      return result;
    }
    if (result.status === 'pending_review') {
      console.log(`  ${label}: sent to owner for review (check mobile app)`);
      console.log(`  Waiting for approval...`);
    } else {
      console.log(`  ${label}: ${result.status}...`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error('Timed out waiting for result');
}

function printResult(result: { status: string; txHash?: string | null; reason?: string | null }) {
  console.log(`  Status: ${result.status}`);
  const explorer = isTestnet ? 'https://sepolia.basescan.org' : 'https://basescan.org';
  if (result.txHash) console.log(`  TX: ${explorer}/tx/${result.txHash}`);
  if (result.reason) console.log(`  Reason: ${result.reason}`);
}

// ── Commands ────────────────────────────────────────────────────────────────

async function cmdListings(slug: string) {
  console.log(`\nFetching listings for "${slug}" on ${openSeaChain}...\n`);

  const listings = await getListings(slug, 10);
  if (listings.length === 0) {
    console.log('No active listings found.');
    return;
  }

  for (const listing of listings) {
    const priceEth = formatEther(BigInt(listing.current_price));
    const nftToken = listing.protocol_data.parameters.offer[0]?.token ?? 'unknown';
    const tokenId = listing.protocol_data.parameters.offer[0]?.identifierOrCriteria ?? '?';
    console.log(`  ${priceEth} ETH — Token #${tokenId}`);
    console.log(`    Contract: ${nftToken}`);
    console.log(`    Order: ${listing.order_hash.slice(0, 18)}...`);
    console.log();
  }
}

async function cmdCollection(slug: string) {
  console.log(`\nCollection: ${slug}\n`);
  const info = await getCollectionInfo(slug);
  console.log(`  Name: ${info.name}`);
  console.log(`  Description: ${info.description?.slice(0, 200) ?? 'N/A'}`);
  console.log(`  Supply: ${info.total_supply}`);
  if (info.contracts?.length) {
    for (const c of info.contracts) {
      console.log(`  Contract: ${c.address} (${c.chain})`);
    }
  }
}

async function cmdBuy(slug: string) {
  const vault = axon.vaultAddress as Address;
  const weth = WETH[chainId];
  if (!weth) {
    console.error(`No WETH address configured for chain ${chainId}`);
    process.exit(1);
  }

  console.log(`\n-- Buy cheapest NFT from "${slug}" --`);
  console.log(`  Vault: ${vault}`);
  console.log(`  Chain: ${openSeaChain}`);
  console.log(`  Seaport: ${SEAPORT}\n`);

  // 1. Get cheapest listing
  const listings = await getListings(slug, 1);
  if (listings.length === 0) {
    console.log('No active listings found.');
    return;
  }
  const listing = listings[0];
  const priceWei = BigInt(listing.current_price);
  const priceEth = formatEther(priceWei);
  const tokenId = listing.protocol_data.parameters.offer[0]?.identifierOrCriteria ?? '?';
  const nftContract = listing.protocol_data.parameters.offer[0]?.token ?? 'unknown';

  console.log(`  Found: Token #${tokenId} at ${priceEth} ETH`);
  console.log(`  NFT contract: ${nftContract}`);
  console.log(`  Seller: ${listing.maker.address}`);

  // 2. Check vault WETH balance
  const wethBalance = await publicClient.readContract({
    address: weth,
    abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
    functionName: 'balanceOf',
    args: [vault],
  });
  console.log(`  Vault WETH: ${formatEther(wethBalance)}`);

  if (wethBalance < priceWei) {
    console.error(`\n  Insufficient WETH. Need ${priceEth}, have ${formatEther(wethBalance)}`);
    console.log(`  Fund the vault: send WETH to ${vault}`);
    return;
  }

  // 3. Get fulfillment calldata from OpenSea
  console.log(`\n  Getting fulfillment data from OpenSea...`);
  const fulfillment = await getFulfillmentData(listing.order_hash, vault);
  const seaportCalldata = fulfillment.fulfillment_data.transaction.input_data as Hex;
  const seaportTarget = fulfillment.fulfillment_data.transaction.to as Address;
  const value = BigInt(fulfillment.fulfillment_data.transaction.value ?? '0');

  console.log(`  Seaport target: ${seaportTarget}`);
  console.log(`  Value (ETH): ${formatEther(value)}`);

  // 4. Step 1: Approve WETH to Seaport (persistent approval)
  console.log(`\n  Step 1: Approve WETH to Seaport...`);
  const approveCalldata = encodeFunctionData({
    abi: parseAbi(['function approve(address spender, uint256 amount) returns (bool)']),
    functionName: 'approve',
    args: [SEAPORT, priceWei],
  });

  let result = await axon.execute({
    protocol: weth,
    callData: approveCalldata,
    token: weth,
    amount: 0n, // No token pull — just approval calldata
    protocolName: 'WETH Approve for Seaport',
    memo: `Approve ${priceEth} WETH for NFT purchase`,
  });

  if (result.requestId && !result.txHash) {
    result = await waitForResult(result.requestId, 'WETH approve');
  }
  if (result.status !== 'approved') {
    console.log('  WETH approval failed. Cannot proceed.');
    printResult(result);
    return;
  }
  console.log(`  WETH approved.`);

  // 5. Step 2: Execute the Seaport fulfillment
  console.log(`\n  Step 2: Fulfill Seaport order...`);
  result = await axon.execute({
    protocol: seaportTarget,
    callData: seaportCalldata,
    token: weth,
    amount: priceWei, // The WETH amount the vault pays
    protocolName: 'OpenSea Seaport',
    memo: `Buy NFT #${tokenId} from ${slug} for ${priceEth} ETH`,
  });

  if (result.requestId && !result.txHash) {
    result = await waitForResult(result.requestId, 'Seaport buy');
  }
  printResult(result);

  if (result.status === 'approved') {
    console.log(`\n  NFT #${tokenId} purchased and held by vault ${vault}`);
    // Verify ownership
    try {
      const owner = await publicClient.readContract({
        address: nftContract as Address,
        abi: parseAbi(['function ownerOf(uint256) view returns (address)']),
        functionName: 'ownerOf',
        args: [BigInt(tokenId)],
      });
      console.log(`  Verified owner: ${owner}`);
    } catch {
      console.log(`  (Could not verify ownership — may be ERC-1155)`);
    }
  }
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const USAGE = `
OpenSea NFT Buy Bot — buy NFTs from OpenSea into your Axon vault

Commands:
  listings <collection-slug>   Browse floor listings for a collection
  buy <collection-slug>        Buy the cheapest listed NFT
  collection <collection-slug> Show collection info

Examples:
  npx tsx buy.ts listings base-sepolia-nfts
  npx tsx buy.ts buy base-sepolia-nfts
  npx tsx buy.ts collection base-sepolia-nfts

Environment:
  OPENSEA_API_KEY    Required — get one at https://docs.opensea.io/reference/api-keys
  AXON_VAULT_ADDRESS Vault address
  AXON_BOT_PRIVATE_KEY Bot private key
  AXON_CHAIN_ID      84532 (Base Sepolia) or 8453 (Base mainnet)
`;

async function main() {
  const cmd = process.argv[2]?.toLowerCase();
  const slug = process.argv[3];

  if (!cmd || cmd === 'help' || !slug) {
    console.log(USAGE);
    if (cmd && !slug) console.log('Error: collection slug is required.\n');
    return;
  }

  console.log(`Vault: ${axon.vaultAddress}`);
  console.log(`Bot:   ${axon.botAddress}`);
  console.log(`Chain: ${openSeaChain}`);

  if (cmd === 'listings') await cmdListings(slug);
  else if (cmd === 'buy') await cmdBuy(slug);
  else if (cmd === 'collection') await cmdCollection(slug);
  else {
    console.log(`Unknown command: ${cmd}`);
    console.log(USAGE);
  }
}

main().catch((err) => {
  console.error('Error:', err.message ?? err);
  process.exit(1);
});
