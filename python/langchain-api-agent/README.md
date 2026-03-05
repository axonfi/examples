# LangChain API-Paying Agent

## What it does

A chatbot that can send money. You talk to it in plain English:

- "Pay 5 USDC to 0xABC for the weather report"
- "What's my vault balance?"
- "Check the status of my last payment"

The bot signs the payment, the Axon relayer executes it on-chain, and your vault's spending limits prevent overspending. The bot never holds ETH for gas and never touches your vault's private key.

**Chain:** Base Sepolia (testnet, free)
**Token:** USDC
**LLM:** Claude (via Anthropic API)
**Framework:** LangChain with tool calling

## How it works

```
You:    "Pay 2 USDC to 0xAbC...123 for the weather report"
Agent:  [calls axon_pay tool]
        → signs EIP-712 intent with bot key
        → sends to Axon relayer
        → relayer checks spending limits
        → relayer submits on-chain via your vault
Agent:  "Payment sent! TX: 0x..."
```

The agent has 3 tools:
- **axon_pay** — send USDC to any address with a memo
- **axon_balance** — check how much USDC is in the vault
- **axon_poll** — check if a pending payment was approved or rejected

## Setup

1. Deploy a vault on [Base Sepolia](https://app.axonfi.xyz)
2. Deposit test USDC from [Circle Faucet](https://faucet.circle.com/)
3. Register a bot in the dashboard and save its private key

```bash
pip install -r requirements.txt
cp .env.example .env
# Fill in: AXON_VAULT_ADDRESS, AXON_BOT_PRIVATE_KEY, ANTHROPIC_API_KEY
python agent.py
```

## Example Session

```
Axon LangChain Agent (type 'quit' to exit)
Bot: 0xda964c6C53394d9d9E49DfA29C2db39aB74fC74F

> Pay 1 USDC to 0x000000000000000000000000000000000000dEaD for API access

  [axon_pay] {'to': '0x...dead', 'token': 'USDC', 'amount': '1', 'memo': 'API access'}
  → Payment approved! TX: 0xabc123...

Done! I sent 1 USDC to 0x...dead for API access. Transaction: 0xabc123...

> What's my vault balance?

  [axon_balance] {'token': 'USDC'}
  → Vault holds 94.50 USDC

Your vault currently holds 94.50 USDC on Base Sepolia.
```
