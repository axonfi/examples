/**
 * LangChain.js agent with Axon payment tools.
 *
 * Usage:
 *   npm install
 *   cp .env.example .env  # fill in your keys
 *   npx tsx agent.ts
 */

import "dotenv/config";
import * as fs from "fs";
import { AxonClient, Chain, USDC, decryptKeystore } from "@axonfi/sdk";
import { ChatAnthropic } from "@langchain/anthropic";
import { tool } from "@langchain/core/tools";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import * as readline from "readline";
import type { Hex } from "viem";

// ── Load bot key (raw hex or encrypted keystore) ───────────────────────────

async function loadBotKey(): Promise<Hex> {
  if (process.env.AXON_BOT_PRIVATE_KEY) {
    return process.env.AXON_BOT_PRIVATE_KEY as Hex;
  }

  const keystorePath = process.env.AXON_BOT_KEYSTORE_PATH;
  const passphrase = process.env.AXON_BOT_PASSPHRASE;
  if (keystorePath && passphrase) {
    const keystore = JSON.parse(fs.readFileSync(keystorePath, "utf8"));
    return await decryptKeystore(keystore, passphrase);
  }

  throw new Error(
    "Set AXON_BOT_PRIVATE_KEY or AXON_BOT_KEYSTORE_PATH + AXON_BOT_PASSPHRASE"
  );
}

// ── Axon client ─────────────────────────────────────────────────────────────

const botKey = await loadBotKey();
const client = new AxonClient({
  vaultAddress: process.env.AXON_VAULT_ADDRESS! as `0x${string}`,
  chainId: Number(process.env.AXON_CHAIN_ID || Chain.BaseSepolia),
  botPrivateKey: botKey,
});

// ── Tools ───────────────────────────────────────────────────────────────────

const axonPay = tool(
  async ({ to, token, amount, memo }) => {
    const result = await client.pay({
      to: to as `0x${string}`,
      token,
      amount: Number(amount),
      memo: memo || undefined,
    });
    if (result.status === "approved") return `Payment approved! TX: ${result.txHash}`;
    if (result.status === "pending_review") return `Under review (ID: ${result.requestId})`;
    return `Rejected: ${result.reason}`;
  },
  {
    name: "axon_pay",
    description: "Pay a recipient from the Axon vault",
    schema: z.object({
      to: z.string().describe("Recipient address (0x...)"),
      token: z.string().describe("Token symbol (USDC, WETH, etc.)"),
      amount: z.string().describe("Human-readable amount (e.g. '5.0')"),
      memo: z.string().optional().describe("Payment description"),
    }),
  }
);

const axonBalance = tool(
  async ({ token }) => {
    const chainId = Number(process.env.AXON_CHAIN_ID || Chain.BaseSepolia);
    const usdcAddr = USDC[chainId];
    if (!usdcAddr) return "USDC not available on this chain";
    const balance = await client.getBalance(usdcAddr);
    const human = Number(balance) / 1e6;
    return `Vault holds ${human.toFixed(2)} ${token || "USDC"}`;
  },
  {
    name: "axon_balance",
    description: "Check the vault balance for a token",
    schema: z.object({
      token: z.string().optional().describe("Token symbol (default: USDC)"),
    }),
  }
);

// ── Agent loop ──────────────────────────────────────────────────────────────

const tools = [axonPay, axonBalance];
const llm = new ChatAnthropic({ model: "claude-sonnet-4-20250514", temperature: 0 });
const llmWithTools = llm.bindTools(tools);

const systemPrompt = `You are a helpful AI assistant with access to an Axon payment vault.
Vault: ${process.env.AXON_VAULT_ADDRESS}
Chain: Base Sepolia (testnet)
Bot: ${client.botAddress}

Use axon_pay to make payments. Use axon_balance to check balances.`;

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const messages: any[] = [new SystemMessage(systemPrompt)];

  console.log(`Axon LangChain Agent (TypeScript)`);
  console.log(`Bot: ${client.botAddress}\n`);

  const prompt = () =>
    new Promise<string>((resolve) => rl.question("> ", resolve));

  while (true) {
    const input = (await prompt()).trim();
    if (!input || ["quit", "exit", "q"].includes(input.toLowerCase())) break;

    messages.push(new HumanMessage(input));

    while (true) {
      const response = await llmWithTools.invoke(messages);
      messages.push(response);

      const toolCalls = (response as any).tool_calls;
      if (!toolCalls?.length) {
        console.log(`\n${(response as any).content}\n`);
        break;
      }

      for (const tc of toolCalls) {
        console.log(`  [${tc.name}] ${JSON.stringify(tc.args)}`);
        const fn = tools.find((t) => t.name === tc.name)!;
        const result = await fn.invoke(tc.args);
        console.log(`  > ${result}`);
        const { ToolMessage } = await import("@langchain/core/messages");
        messages.push(new ToolMessage({ content: result, tool_call_id: tc.id }));
      }
    }
  }

  rl.close();
}

main().catch(console.error);
