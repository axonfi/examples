# Vault Setup

Full programmatic vault setup from scratch — no dashboard needed.

Deploys a vault, generates a bot keypair, registers the bot with spending limits, deposits funds, and makes a test payment.

## What it does

1. Deploys a new Axon vault on Base Sepolia
2. Generates a fresh bot keypair
3. Registers the bot with $100/tx cap and $1,000/day rolling limit
4. Deposits 0.001 ETH into the vault
5. Sends a test payment (0.0001 ETH back to the owner)

## Setup

```bash
npm install
cp .env.example .env   # add your owner private key (funded with testnet ETH)
```

Get testnet ETH from [Alchemy Base Sepolia Faucet](https://www.alchemy.com/faucets/base-sepolia).

## Usage

```bash
npx tsx setup.ts
```
