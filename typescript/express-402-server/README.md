# Express 402 Paywall Server

> **Coming soon** — This example is in progress.

## What it will do

A web server that puts a price on API endpoints. When a bot hits a protected route, the server responds with HTTP 402 ("Payment Required") and tells the bot how much to pay. The bot pays via Axon, the server verifies the payment, and returns the data.

Like putting a $0.01 toll on every API call. The bot pays automatically, the server earns revenue, and nobody needs to set up Stripe or manage subscriptions.

- Express.js middleware that returns 402 for protected routes
- Response includes: price, recipient address, and payment instructions
- Bot pays using `@axonfi/sdk` (or `axonfi` in Python)
- Server polls Axon relayer to verify payment, then unlocks the response
- Works on Base Sepolia testnet with USDC

## Links

- [Website](https://axonfi.xyz)
- [Dashboard](https://app.axonfi.xyz)
- [Documentation](https://axonfi.xyz/llms.txt)
- [Twitter/X — @axonfixyz](https://x.com/axonfixyz)
