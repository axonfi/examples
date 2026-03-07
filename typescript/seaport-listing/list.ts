/**
 * Seaport NFT Listing — List an NFT for sale on OpenSea via the vault.
 *
 * STATUS: FAILS on vault VERSION 3 (missing ERC-1271)
 *
 * Seaport (OpenSea's protocol) uses off-chain signed orders. When an order
 * is created by a smart contract (like our vault), Seaport calls:
 *
 *   IERC1271(order.offerer).isValidSignature(orderHash, signature)
 *
 * If the contract doesn't implement ERC-1271, the call reverts and the
 * order is invalid. Our vault does NOT implement isValidSignature().
 *
 * What works today:
 *   - BUYING NFTs via executeProtocol() (call Seaport.fulfillOrder) — works
 *   - Receiving NFTs (vault implements ERC721Receiver + ERC1155Receiver) — works
 *   - See examples/typescript/opensea-buy for a working buy example
 *
 * What doesn't work:
 *   - LISTING/SELLING NFTs (requires ERC-1271 signature on the vault) — blocked
 *   - Creating limit orders on Cowswap, 1inch, 0x — blocked
 *   - Permit2 signature-based transfers — blocked
 *
 * When vault VERSION 4 adds ERC-1271, this example will work.
 *
 * The isValidSignature() implementation would verify that the signature
 * was produced by the vault owner (or an authorized bot), making it safe
 * for the vault to "sign" Seaport orders.
 */

import { AxonClient, Chain } from '@axonfi/sdk';
import { createPublicClient, http, parseAbi, encodeFunctionData, keccak256, toBytes, concat, pad, toHex } from 'viem';
import { baseSepolia } from 'viem/chains';
import 'dotenv/config';

const axon = new AxonClient({
  vaultAddress: process.env.AXON_VAULT_ADDRESS! as `0x${string}`,
  chainId: Number(process.env.AXON_CHAIN_ID ?? Chain.BaseSepolia),
  botPrivateKey: process.env.AXON_BOT_PRIVATE_KEY! as `0x${string}`,
});

const vault = axon.vaultAddress as `0x${string}`;

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.RPC_URL ?? 'https://sepolia.base.org'),
});

// ── Check ERC-1271 support ───────────────────────────────────────────────────

async function checkERC1271() {
  console.log('\n=== ERC-1271 Support Check ===\n');
  console.log(`Vault: ${vault}\n`);

  // Try calling isValidSignature on the vault
  // ERC-1271 magic value: 0x1626ba7e
  const ERC1271_ABI = parseAbi(['function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)']);

  const testHash = keccak256(toBytes('test'));
  const testSig = ('0x' + '00'.repeat(65)) as `0x${string}`;

  try {
    const result = await client.readContract({
      address: vault,
      abi: ERC1271_ABI,
      functionName: 'isValidSignature',
      args: [testHash, testSig],
    });
    console.log('isValidSignature returned:', result);
    console.log('ERC-1271 is supported!');
  } catch (err) {
    const msg = (err as Error).message;
    console.log('isValidSignature() call REVERTED.');
    console.log('The vault does not implement ERC-1271.\n');
    console.log('Impact — the vault cannot:');
    console.log('  - List NFTs on OpenSea/Blur/LooksRare');
    console.log('  - Create limit orders on Cowswap/1inch/0x');
    console.log('  - Use Permit2 signature-based transfers');
    console.log('  - Delegate via EigenLayer gasless signatures');
    console.log('\nThe vault CAN still:');
    console.log('  - Buy NFTs (fulfillOrder via executeProtocol)');
    console.log('  - Fill existing orders on DEXes');
    console.log('  - Use standard approve+call patterns');

    if (msg.includes('revert') || msg.includes('execution reverted')) {
      console.log('\n=== CONFIRMED: ERC-1271 not implemented ===');
    }
  }
}

// ── Show what a Seaport listing would look like ──────────────────────────────

async function showListing() {
  console.log('\n=== What a Seaport listing would require ===\n');
  console.log('To list an NFT on OpenSea, the vault would need to:');
  console.log('');
  console.log('1. Approve the NFT to Seaport conduit (via executeProtocol)');
  console.log('2. Create an off-chain Seaport order with the vault as offerer');
  console.log('3. Sign the order hash');
  console.log('');
  console.log('Step 3 is where it breaks. Seaport validates the signature by calling:');
  console.log('');
  console.log('  IERC1271(vault).isValidSignature(orderHash, signature)');
  console.log('');
  console.log("Since the vault doesn't implement this, validation fails.");
  console.log('');
  console.log('The fix (VERSION 4) would add isValidSignature() that checks');
  console.log('if the signature was produced by the vault owner:');
  console.log('');
  console.log('  function isValidSignature(bytes32 hash, bytes sig) returns (bytes4) {');
  console.log('    address signer = ECDSA.recover(hash, sig);');
  console.log('    if (signer == owner()) return 0x1626ba7e; // ERC-1271 magic');
  console.log('    return 0xffffffff; // invalid');
  console.log('  }');
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const command = process.argv[2];
switch (command) {
  case 'check':
    await checkERC1271();
    break;
  case 'show':
    await showListing();
    break;
  default:
    console.log('Usage: npx tsx list.ts <check|show>');
    console.log("  check — test if vault supports ERC-1271 (it doesn't)");
    console.log('  show  — explain what a Seaport listing would require');
}
