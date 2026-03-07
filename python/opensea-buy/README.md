# OpenSea NFT Buy Bot (Python)

Buy NFTs from OpenSea into your Axon vault using Seaport and `execute()`.

## Prerequisites

- Axon vault deployed with a registered bot
- OpenSea API key ([get one here](https://docs.opensea.io/reference/api-keys))
- WETH in the vault (most NFT listings are priced in WETH)

## Setup

```bash
pip install -r requirements.txt
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
python buy.py listings <collection-slug>

# Buy the cheapest listed NFT
python buy.py buy <collection-slug>

# Show collection info
python buy.py collection <collection-slug>
```

## How it works

1. Bot queries OpenSea API for the cheapest listing
2. OpenSea returns Seaport fulfillment calldata
3. Bot signs two `ExecuteIntent`s via Axon SDK:
   a. **WETH approve** — let Seaport spend WETH from the vault
   b. **Seaport fulfillOrder** — execute the purchase
4. Relayer validates, screens, and submits on-chain
5. Vault receives the NFT via `onERC721Received()`

## Security

NFT operations go through Axon's screening pipeline:
- **NFT approvals** (WETH approve) may trigger human review
- **NFT transfers** force AI scan regardless of value
- Owner can reject from the mobile app
