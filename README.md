# Axon Examples

Working examples showing how AI agents use [Axon](https://axonfi.xyz) to make on-chain payments without touching private keys or gas.

## What is Axon?

Think of it like a corporate credit card for AI agents. You (the owner) set up a vault with USDC, register your bot with spending limits ($50/day, $10 per transaction), and the bot can pay for things on its own. If it tries to spend too much, it gets blocked. You can watch everything from a dashboard and approve/reject suspicious payments.

## Examples

### Python

| Example | What it does (plain English) |
|---------|------------------------------|
| [langchain-api-agent](python/langchain-api-agent/) | **A chatbot that can send money.** You talk to it in natural language ("pay 5 USDC to 0xABC for the weather data") and it sends the payment from your vault. Built with LangChain + Claude. |
| [cli-payments](python/cli-payments/) | **Venmo from the command line.** `python cli.py pay 0xABC USDC 5` sends 5 USDC. Also checks balances and payment status. Simplest possible Axon integration. |
| [defi-trading-agent](python/defi-trading-agent/) | **Auto-buys ETH when the price dips.** Watches ETH/USD on CoinGecko every 30 seconds. When ETH drops below $2,000, it swaps USDC to WETH inside the vault via Uniswap on Base. Like a DCA bot, but the funds never leave the vault. |

### TypeScript

| Example | What it does (plain English) |
|---------|------------------------------|
| [langchain-api-agent](typescript/langchain-api-agent/) | **Same chatbot-that-pays, but in TypeScript.** LangChain.js + Claude + `@axonfi/sdk`. |
| [elizaos-agent](typescript/elizaos-agent/) | **An ElizaOS character that can tip people.** Uses `@axonfi/plugin-elizaos`. Say "tip @alice 10 USDC" and it pays from the vault. *(Coming soon)* |
| [express-402-server](typescript/express-402-server/) | **A paywall for APIs.** Your server returns HTTP 402 ("Payment Required"). The bot pays, gets the content. Like putting a $0.01 toll on every API call. *(Coming soon)* |

## Prerequisites

1. **Deploy a vault** on [Base Sepolia](https://app.axonfi.xyz) (free testnet — no real money)
2. **Get test USDC** from [Circle Faucet](https://faucet.circle.com/) and deposit it into your vault
3. **Register a bot** in the dashboard — this gives you a bot private key

## Quick Start

```bash
# Python
cd python/langchain-api-agent
pip install -r requirements.txt
cp .env.example .env  # Put your vault address, bot key, and Anthropic key
python agent.py

# TypeScript
cd typescript/langchain-api-agent
npm install
cp .env.example .env
npx tsx agent.ts
```

## Links

- [Website](https://axonfi.xyz)
- [Dashboard](https://app.axonfi.xyz) — deploy vaults, manage bots, review payments
- [Documentation](https://axonfi.xyz/llms.txt)
- [npm — @axonfi/sdk](https://www.npmjs.com/package/@axonfi/sdk) — `npm install @axonfi/sdk`
- [PyPI — axonfi](https://pypi.org/project/axonfi/) — `pip install axonfi`
- [Smart Contracts](https://github.com/axonfi/contracts)
- [Twitter/X — @axonfixyz](https://x.com/axonfixyz)
