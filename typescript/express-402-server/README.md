# Express 402 Paywall Server

## What it does (planned)

A web server that puts a price on API endpoints. When a bot hits a protected route, the server responds with HTTP 402 ("Payment Required") and tells the bot how much to pay. The bot pays via Axon, the server verifies the payment, and returns the data.

Like putting a $0.01 toll on every API call. The bot pays automatically, the server earns revenue, and nobody needs to set up Stripe or manage subscriptions.

**Status:** Coming soon.

## What it will demonstrate

- Express.js middleware that returns 402 for protected routes
- Response includes: price, recipient address, and payment instructions
- Bot pays using `@axonfi/sdk` (or `axonfi` in Python)
- Server polls Axon relayer to verify payment, then unlocks the response
- Works on Base Sepolia testnet with USDC
