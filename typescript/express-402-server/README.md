# Express x402 Paywall Server

A web server that puts a price on API endpoints using the [x402 protocol](https://www.x402.org/). When a bot hits a protected route, the server responds with HTTP 402 and tells the bot how much to pay. The bot pays via Axon, retries with a payment signature, and gets the data.

Like putting a $0.01 toll on every API call. The bot pays automatically, the server earns revenue, and nobody needs to set up Stripe or manage subscriptions.

## What's included

- **`server.ts`** — Express server with x402 paywall middleware. Protects `GET /api/weather` behind a 0.01 USDC paywall on Base Sepolia.
- **`bot-client.ts`** — Bot that hits the paywall, pays via `@axonfi/sdk`, and retries automatically.

## Prerequisites

1. An Axon vault on Base Sepolia with USDC deposited — deploy one at [app.axonfi.xyz](https://app.axonfi.xyz)
2. A registered bot with a private key (generate in the dashboard or bring your own)
3. Node.js 18+

## Setup

```bash
npm install
```

Create a `.env` file:

```bash
# Server — the address that receives payments
MERCHANT_ADDRESS=0xYourMerchantAddress

# Bot client — Axon vault + bot credentials
AXON_VAULT_ADDRESS=0xYourVaultAddress
AXON_CHAIN_ID=84532

# Option 1: raw private key (for testing)
AXON_BOT_PRIVATE_KEY=0x...

# Option 2: encrypted keystore (recommended)
# AXON_BOT_KEYSTORE_PATH=./axon-bot.json
# AXON_BOT_PASSPHRASE=your-passphrase
```

## Run

Start the server in one terminal:

```bash
npx tsx server.ts
```

Run the bot in another:

```bash
npx tsx bot-client.ts
```

## How it works

### Server side

1. Bot requests `GET /api/weather`
2. Middleware checks for a `PAYMENT-SIGNATURE` header
3. No signature? Return **402** with a `PAYMENT-REQUIRED` header containing base64-encoded JSON:

```json
{
  "x402Version": 1,
  "resource": {
    "url": "http://localhost:3402/api/weather",
    "description": "Current weather data",
    "mimeType": "application/json"
  },
  "accepts": [
    {
      "payTo": "0xMerchant...",
      "amount": "10000",
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "network": "eip155:84532",
      "scheme": "exact"
    }
  ]
}
```

4. Bot retries with `PAYMENT-SIGNATURE` header, server grants access

### Bot side

1. Hit the endpoint, get 402
2. Call `client.x402.handlePaymentRequired(response.headers)` — the SDK:
   - Parses the `PAYMENT-REQUIRED` header
   - Finds a matching payment option for the bot's chain
   - Funds the bot's EOA from the vault (full Axon pipeline: policies, AI scan)
   - Signs an EIP-3009 (USDC) or Permit2 authorization
   - Returns a `PAYMENT-SIGNATURE` header value
3. Retry the request with the signature header
4. Get the weather data

## Links

- [Website](https://axonfi.xyz)
- [Dashboard](https://app.axonfi.xyz)
- [Documentation](https://axonfi.xyz/llms.txt)
- [npm — @axonfi/sdk](https://www.npmjs.com/package/@axonfi/sdk)
- [Twitter/X — @axonfixyz](https://x.com/axonfixyz)
