/**
 * Seaport NFT Listing — List an NFT for sale on OpenSea via the vault.
 *
 * Demonstrates ERC-1271 support. When an off-chain order is created by a smart
 * contract (like an Axon vault), Seaport validates the signature by calling:
 *
 *   IERC1271(order.offerer).isValidSignature(orderHash, signature)
 *
 * The vault implements isValidSignature() and returns the magic value (0x1626ba7e)
 * if the signer is the vault owner or an active registered bot. This enables
 * bots to create signed Seaport orders on behalf of the vault.
 *
 * The same ERC-1271 support enables:
 *   - NFT listings on OpenSea, Blur, LooksRare
 *   - Limit orders on Cowswap, 1inch, 0x
 *   - Permit2 signature-based transfers
 *   - EigenLayer gasless delegation signatures
 *
 * Setup:
 *   1. Deploy vault on Base Sepolia
 *   2. Register bot
 *   3. Transfer an NFT to the vault
 *
 * Usage:
 *   cp .env.example .env
 *   npm install
 *   npx tsx list.ts check    # verify ERC-1271 support on vault
 *   npx tsx list.ts show     # explain what a Seaport listing requires
 */

import { AxonClient, Chain } from '@axonfi/sdk';
import { createPublicClient, http, parseAbi, keccak256, toBytes } from 'viem';
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
    if (result === '0x1626ba7e') {
      console.log('ERC-1271 is supported! The vault can sign off-chain orders.');
    } else {
      console.log('Returned non-magic value — signature was not from owner or active bot.');
      console.log('(This is expected for a dummy test signature.)');
    }
  } catch (err) {
    console.log('isValidSignature() call failed.');
    console.log('Error:', (err as Error).message);
  }

  console.log('\nThe vault validates signatures from:');
  console.log('  - The vault owner (hardware wallet / multisig)');
  console.log('  - Any active registered bot');
  console.log('\nThis enables bots to create Seaport orders, Cowswap limit orders, etc.');
}

// ── Show what a Seaport listing requires ────────────────────────────────────

async function showListing() {
  console.log('\n=== Seaport Listing Flow ===\n');
  console.log('To list an NFT on OpenSea via an Axon vault:');
  console.log('');
  console.log('1. Approve the NFT to Seaport conduit (via executeProtocol)');
  console.log('2. Create an off-chain Seaport order with the vault as offerer');
  console.log('3. Sign the order hash with the bot key');
  console.log('4. Submit the signed order to OpenSea API');
  console.log('');
  console.log('When a buyer fills the order, Seaport calls:');
  console.log('');
  console.log('  IERC1271(vault).isValidSignature(orderHash, botSignature)');
  console.log('');
  console.log('The vault verifies the bot is registered and active, then returns');
  console.log('the magic value 0x1626ba7e — order is valid, trade executes.');
  console.log('');
  console.log('  function isValidSignature(bytes32 hash, bytes sig) returns (bytes4) {');
  console.log('    address signer = ECDSA.recover(hash, sig);');
  console.log('    if (signer == owner() || bots[signer].isActive)');
  console.log('      return 0x1626ba7e; // ERC-1271 magic');
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
    console.log('  check — verify vault supports ERC-1271 signatures');
    console.log('  show  — explain the Seaport listing flow');
}
