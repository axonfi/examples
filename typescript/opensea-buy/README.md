# OpenSea NFT Buy Bot

Buy NFTs from OpenSea into your Axon vault using Seaport and `executeProtocol()`.

The vault acts as the buyer — it holds the NFTs, and only the owner can withdraw them via `withdrawERC721()` / `withdrawERC1155()`.

## Prerequisites

- Axon vault deployed with a registered bot
- OpenSea API key ([get one here](https://docs.opensea.io/reference/api-keys))
- WETH in the vault (most NFT listings are priced in WETH)

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your vault address, bot key, and OpenSea API key
```

### One-time vault setup

```bash
# Approve Seaport 1.6 as a protocol on your vault
cast send <vault> "approveProtocol(address)" \
  0x0000000000000068F116a894984e2DB1123eB395 \
  --private-key <owner-key> --rpc-url https://sepolia.base.org

# Also approve WETH as a protocol (for WETH.approve calls)
cast send <vault> "approveProtocol(address)" \
  0x4200000000000000000000000000000000000006 \
  --private-key <owner-key> --rpc-url https://sepolia.base.org
```

## Usage

```bash
# Browse floor listings for a collection
npx tsx buy.ts listings <collection-slug>

# Buy the cheapest listed NFT
npx tsx buy.ts buy <collection-slug>

# Show collection info
npx tsx buy.ts collection <collection-slug>
```

## How it works

1. Bot queries OpenSea API for the cheapest listing in a collection
2. OpenSea returns Seaport fulfillment calldata (the exact transaction to execute)
3. Bot signs two `ExecuteIntent`s via Axon:
   a. **WETH approve** — approve Seaport to spend WETH from the vault
   b. **Seaport fulfillOrder** — execute the purchase
4. Relayer validates signatures, runs AI screening, and submits on-chain
5. Vault receives the NFT via `onERC721Received()`

## Security

NFT operations go through Axon's screening pipeline:
- **NFT approvals** (like WETH approve to Seaport) trigger human review
- **NFT transfers** force AI scan regardless of USD value
- The vault owner can reject any suspicious operation from the mobile app

## Supported chains

| Chain | Seaport 1.6 | OpenSea API chain |
|-------|-------------|-------------------|
| Base Sepolia | `0x00...B395` | `base_sepolia` |
| Base | `0x00...B395` | `base` |
