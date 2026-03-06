/**
 * Express server with x402 paywall middleware.
 *
 * Protects GET /api/weather behind a 0.01 USDC paywall on Base Sepolia.
 * Returns HTTP 402 with a PAYMENT-REQUIRED header containing the x402
 * payment requirements. Clients pay via EIP-3009 or Permit2, then retry
 * with a PAYMENT-SIGNATURE header.
 *
 * Usage:
 *   npm install
 *   cp .env.example .env  # fill in MERCHANT_ADDRESS
 *   npx tsx server.ts
 */

import 'dotenv/config';
import express from 'express';

// ── Config ──────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT || 3402);
const MERCHANT_ADDRESS = process.env.MERCHANT_ADDRESS;
if (!MERCHANT_ADDRESS) {
  console.error('Set MERCHANT_ADDRESS in .env (the address that receives payments)');
  process.exit(1);
}

// Base Sepolia USDC
const USDC_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const CHAIN_ID = 84532;
const PRICE_USDC = '10000'; // 0.01 USDC (6 decimals)

// ── x402 Middleware ─────────────────────────────────────────────────────────

/**
 * Build the base64-encoded PAYMENT-REQUIRED header value.
 *
 * This follows the x402 spec:
 * - resource: describes what the client is paying for
 * - accepts: array of payment options (chain, token, amount, recipient)
 */
function buildPaymentRequiredHeader(resourceUrl: string, description: string): string {
  const payload = {
    x402Version: 1,
    resource: {
      url: resourceUrl,
      description,
      mimeType: 'application/json',
    },
    accepts: [
      {
        payTo: MERCHANT_ADDRESS,
        amount: PRICE_USDC,
        asset: USDC_ADDRESS,
        network: `eip155:${CHAIN_ID}`,
        scheme: 'exact',
      },
    ],
  };

  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

/**
 * Middleware that gates a route behind an x402 paywall.
 *
 * If the request has a valid PAYMENT-SIGNATURE header, it passes through.
 * Otherwise, it returns 402 with the PAYMENT-REQUIRED header.
 *
 * In production, you would verify the EIP-3009 or Permit2 signature
 * on-chain or via an indexer. This example accepts any non-empty signature
 * for demonstration purposes.
 */
function x402Paywall(description: string) {
  return (req: express.Request, res: express.Response, next: express.NextFunction): void => {
    const paymentSignature = req.headers['payment-signature'];

    if (paymentSignature) {
      // In production: decode the base64 header, verify the EIP-3009 / Permit2
      // authorization on-chain (check transferWithAuthorization was executed,
      // or the Permit2 transfer was completed). For this demo, we accept any
      // non-empty signature header.
      console.log(`  [x402] Payment signature received — granting access`);
      next();
      return;
    }

    // No payment — return 402 with payment requirements
    const resourceUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const headerValue = buildPaymentRequiredHeader(resourceUrl, description);

    console.log(`  [x402] No payment — returning 402 for ${req.path}`);
    res.status(402).set('PAYMENT-REQUIRED', headerValue).json({
      error: 'Payment Required',
      message: `This endpoint costs 0.01 USDC. Pay via the x402 protocol.`,
      x402: true,
    });
  };
}

// ── Routes ──────────────────────────────────────────────────────────────────

const app = express();

app.get('/api/weather', x402Paywall('Current weather data'), (_req, res) => {
  res.json({
    location: 'San Francisco, CA',
    temperature: 18,
    unit: 'celsius',
    condition: 'Partly cloudy',
    humidity: 72,
    wind: { speed: 15, direction: 'WSW', unit: 'km/h' },
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// ── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`x402 paywall server running on http://localhost:${PORT}`);
  console.log(`  Merchant:  ${MERCHANT_ADDRESS}`);
  console.log(`  Price:     0.01 USDC (Base Sepolia)`);
  console.log(`  Endpoint:  GET /api/weather`);
  console.log();
  console.log(`Try it:`);
  console.log(`  curl http://localhost:${PORT}/api/weather`);
  console.log(`  → 402 Payment Required`);
});
