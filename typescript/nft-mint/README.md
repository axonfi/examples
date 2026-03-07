# NFT Minting via Axon Vault

Mint ERC-721 NFTs directly into your Axon vault using `executeProtocol()`.

The vault implements `IERC721Receiver`, so it can safely receive NFTs from any contract that uses `safeTransferFrom` (Seaport, Uniswap V3 LP, custom mints, etc.).

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your vault address and bot private key
```

### One-time vault setup

```bash
# Approve the NFT contract as a protocol on your vault
cast send <vault> "approveProtocol(address)" <nft-contract> \
  --private-key <owner-key> --rpc-url https://sepolia.base.org
```

## Usage

```bash
# Mint a new NFT to the vault
npx tsx nft.ts mint

# List NFTs owned by the vault
npx tsx nft.ts list

# Show details for a specific NFT
npx tsx nft.ts info 0
```

## How it works

1. Bot signs an `ExecuteIntent` targeting the NFT contract's `mint(vault)` function
2. Relayer validates the signature and submits via `executeProtocol()`
3. NFT contract calls `safeTransferFrom` → vault's `onERC721Received()` accepts it
4. Owner can withdraw NFTs via `withdrawERC721(nft, tokenId, to)`

## NFT support in AxonVault

| Feature | Supported |
|---------|-----------|
| Receive ERC-721 (safeTransferFrom) | Yes |
| Receive ERC-1155 | Yes |
| Owner withdraw ERC-721 | Yes (`withdrawERC721`) |
| Owner withdraw ERC-1155 | Yes (`withdrawERC1155`) |
| Bot mint/buy NFTs via executeProtocol | Yes |
| ERC-165 supportsInterface | Yes |
