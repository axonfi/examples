# Axon Examples

Working examples showing how AI agents use [Axon](https://axonfi.xyz) to make on-chain payments without touching private keys or gas.

## What is Axon?

Think of it like a corporate credit card for AI agents. You (the owner) set up a vault with USDC, register your bot with spending limits ($50/day, $10 per transaction), and the bot can pay for things on its own. If it tries to spend too much, it gets blocked. You can watch everything from a dashboard and approve/reject suspicious payments.

## Examples

| Example                                                | Lang                                                                                           | What it does (plain English)                                                                                                                                                                                                        |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [vault-setup](python/vault-setup/)                     | ![Python](https://img.shields.io/badge/-Python-3776AB?logo=python&logoColor=white)             | **Deploy everything from code.** Deploys a vault, generates a bot key, sets spending limits, deposits ETH, and makes a test payment. No dashboard needed.                                                                           |
| [vault-setup](typescript/vault-setup/)                 | ![TypeScript](https://img.shields.io/badge/-TypeScript-3178C6?logo=typescript&logoColor=white) | **Deploy everything from code.** Same flow as above — vault deploy, bot setup, deposit, test payment.                                                                                                                               |
| [aave-lending](python/aave-lending/)                   | ![Python](https://img.shields.io/badge/-Python-3776AB?logo=python&logoColor=white)             | **Earn yield on Aave.** Supplies USDC to Aave V3, gets aTokens back in the vault. Shows how to use tokens NOT in Axon's built-in list (Aave's own test USDC).                                                                       |
| [aave-lending](typescript/aave-lending/)               | ![TypeScript](https://img.shields.io/badge/-TypeScript-3178C6?logo=typescript&logoColor=white) | **Earn yield on Aave.** Supply/withdraw USDC via Aave V3 Pool. Demonstrates working with arbitrary token addresses.                                                                                                                 |
| [swap-and-pay](python/swap-and-pay/)                   | ![Python](https://img.shields.io/badge/-Python-3776AB?logo=python&logoColor=white)             | **Pay USDC when vault only has WETH.** The relayer auto-swaps via Uniswap and sends the payment in one transaction. Bot code is identical to a direct payment.                                                                      |
| [swap-and-pay](typescript/swap-and-pay/)               | ![TypeScript](https://img.shields.io/badge/-TypeScript-3178C6?logo=typescript&logoColor=white) | **Pay USDC when vault only has WETH.** Same auto-swap pattern in TypeScript.                                                                                                                                                        |
| [langchain-api-agent](python/langchain-api-agent/)     | ![Python](https://img.shields.io/badge/-Python-3776AB?logo=python&logoColor=white)             | **A chatbot that can send money.** You talk to it in natural language ("pay 5 USDC to 0xABC for the weather data") and it sends the payment from your vault. Built with LangChain + Claude.                                         |
| [langchain-api-agent](typescript/langchain-api-agent/) | ![TypeScript](https://img.shields.io/badge/-TypeScript-3178C6?logo=typescript&logoColor=white) | **Same chatbot-that-pays, but in TypeScript.** LangChain.js + Claude + `@axonfi/sdk`.                                                                                                                                               |
| [cli-payments](python/cli-payments/)                   | ![Python](https://img.shields.io/badge/-Python-3776AB?logo=python&logoColor=white)             | **Venmo from the command line.** `python cli.py pay 0xABC USDC 5` sends 5 USDC. Also checks balances and payment status. Simplest possible Axon integration.                                                                        |
| [defi-trading-agent](python/defi-trading-agent/)       | ![Python](https://img.shields.io/badge/-Python-3776AB?logo=python&logoColor=white)             | **Auto-buys ETH when the price dips.** Watches ETH/USD on CoinGecko every 30 seconds. When ETH drops below $2,000, it swaps USDC to WETH inside the vault via Uniswap on Base. Like a DCA bot, but the funds never leave the vault. |
| [ostium-perps-trader](python/ostium-perps-trader/)     | ![Python](https://img.shields.io/badge/-Python-3776AB?logo=python&logoColor=white)             | **Opens perpetual futures from a vault.** The vault itself is the trader on [Ostium](https://ostium.io) — it approves USDC, calls `openTrade`, and the position belongs to the vault. Gains stay under owner control, not the bot.  |
| [elizaos-agent](typescript/elizaos-agent/)             | ![TypeScript](https://img.shields.io/badge/-TypeScript-3178C6?logo=typescript&logoColor=white) | **An ElizaOS character that can tip people.** Uses `@axonfi/plugin-elizaos`. Say "tip @alice 10 USDC" and it pays from the vault. _(Coming soon)_                                                                                   |
| [express-402-server](typescript/express-402-server/)   | ![TypeScript](https://img.shields.io/badge/-TypeScript-3178C6?logo=typescript&logoColor=white) | **A paywall for APIs.** Your server returns HTTP 402 ("Payment Required"). The bot detects it, pays via x402, retries with a payment signature, and gets the data.                                                                  |

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
