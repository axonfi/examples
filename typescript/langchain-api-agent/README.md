# LangChain API-Paying Agent (TypeScript)

## What it does

Same as the [Python version](../../python/langchain-api-agent/) but in TypeScript. A chatbot you talk to in plain English, and it can send USDC from your vault.

- "Pay 5 USDC to 0xABC for the report"
- "What's my balance?"

Built with LangChain.js + Claude + `@axonfi/sdk`.

**Chain:** Base Sepolia (testnet, free)
**Token:** USDC
**LLM:** Claude (via Anthropic API)

## Setup

```bash
npm install
cp .env.example .env
# Fill in: AXON_VAULT_ADDRESS, AXON_BOT_PRIVATE_KEY, ANTHROPIC_API_KEY
npx tsx agent.ts
```

## How it works

The agent has 2 tools:
- **axon_pay** — send USDC to any address with a memo
- **axon_balance** — check how much USDC is in the vault

When you ask it to pay someone, it signs an EIP-712 intent with the bot key, sends it to the Axon relayer, and the relayer executes the payment on-chain through your vault. Your spending limits are enforced automatically.
