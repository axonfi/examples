"""LangChain agent with an Axon payment tool.

The agent can pay for API calls, check vault balances, and poll payment status
— all through natural language. Payments are signed as EIP-712 intents and
executed through the Axon relayer with spending policy enforcement.

Usage:
    pip install -r requirements.txt
    cp .env.example .env  # fill in your keys
    python agent.py
"""

import json
import os
import sys

from dotenv import load_dotenv
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.tools import tool

from axonfi import AxonClientSync, Chain

load_dotenv()


def _load_bot_key() -> str:
    """Load bot private key from env (raw hex) or keystore file + passphrase."""
    raw_key = os.environ.get("AXON_BOT_PRIVATE_KEY")
    if raw_key:
        return raw_key

    keystore_path = os.environ.get("AXON_BOT_KEYSTORE_PATH")
    passphrase = os.environ.get("AXON_BOT_PASSPHRASE")
    if keystore_path and passphrase:
        from eth_account import Account

        with open(keystore_path) as f:
            keystore = json.load(f)
        return "0x" + Account.decrypt(keystore, passphrase).hex()

    print("Error: set AXON_BOT_PRIVATE_KEY or AXON_BOT_KEYSTORE_PATH + AXON_BOT_PASSPHRASE", file=sys.stderr)
    sys.exit(1)


# ── Axon client (sync wrapper for LangChain) ────────────────────────────────

client = AxonClientSync(
    vault_address=os.environ["AXON_VAULT_ADDRESS"],
    chain_id=int(os.environ.get("AXON_CHAIN_ID", str(Chain.BaseSepolia))),
    bot_private_key=_load_bot_key(),
)


# ── Tools ────────────────────────────────────────────────────────────────────


@tool
def axon_pay(to: str, token: str, amount: float, memo: str = "") -> str:
    """Pay a recipient from the Axon vault.

    Args:
        to: Recipient address (0x...)
        token: Token symbol (USDC, WETH, etc.)
        amount: Human-readable amount (e.g. 5.0 for 5 USDC)
        memo: Optional payment description
    """
    result = client.pay(to=to, token=token, amount=amount, memo=memo or None)
    if result.status == "approved":
        return f"Payment approved! TX: {result.tx_hash}"
    elif result.status == "pending_review":
        return f"Payment is under review (request ID: {result.request_id}). Poll for status."
    else:
        return f"Payment rejected: {result.reason}"


@tool
def axon_balance(token: str = "USDC") -> str:
    """Check the vault balance for a token.

    Args:
        token: Token symbol (default: USDC)
    """
    from axonfi import KNOWN_TOKENS, resolve_token

    chain_id = int(os.environ.get("AXON_CHAIN_ID", str(Chain.BaseSepolia)))
    token_address = resolve_token(token, chain_id)
    balance_raw = client.get_balance(token_address)

    decimals = KNOWN_TOKENS.get(token, None)
    if decimals:
        human = balance_raw / (10 ** decimals.decimals)
        return f"Vault holds {human:.2f} {token}"
    return f"Vault holds {balance_raw} base units of {token}"


@tool
def axon_poll(request_id: str) -> str:
    """Poll the status of a pending payment.

    Args:
        request_id: The request ID returned from a pending payment
    """
    result = client.poll(request_id)
    if result.status == "approved":
        return f"Payment approved! TX: {result.tx_hash}"
    elif result.status == "pending_review":
        return "Still under review. Try again in a few seconds."
    else:
        return f"Payment rejected: {result.reason}"


# ── Agent ────────────────────────────────────────────────────────────────────

tools = [axon_pay, axon_balance, axon_poll]

llm = ChatAnthropic(model="claude-sonnet-4-20250514", temperature=0)
llm_with_tools = llm.bind_tools(tools)

SYSTEM_PROMPT = f"""You are a helpful AI assistant with access to an Axon payment vault.
You can pay recipients, check balances, and poll payment status.

Vault: {os.environ["AXON_VAULT_ADDRESS"]}
Chain: Base Sepolia (testnet)
Bot address: {client.bot_address}

When asked to make a payment, use the axon_pay tool. Always confirm the amount and recipient before paying.
When asked about balances, use axon_balance.
"""


def run_agent():
    """Simple agent loop with tool calling."""
    messages = [SystemMessage(content=SYSTEM_PROMPT)]

    print("Axon LangChain Agent (type 'quit' to exit)")
    print(f"Bot: {client.bot_address}")
    print()

    while True:
        user_input = input("> ").strip()
        if not user_input or user_input.lower() in ("quit", "exit", "q"):
            break

        messages.append(HumanMessage(content=user_input))

        # LLM may call tools in a loop
        while True:
            response = llm_with_tools.invoke(messages)
            messages.append(response)

            if not response.tool_calls:
                print(f"\n{response.content}\n")
                break

            # Execute each tool call
            for tool_call in response.tool_calls:
                tool_name = tool_call["name"]
                tool_args = tool_call["args"]
                print(f"  [{tool_name}] {tool_args}")

                # Find and execute the tool
                tool_fn = next(t for t in tools if t.name == tool_name)
                result = tool_fn.invoke(tool_args)
                print(f"  → {result}")

                from langchain_core.messages import ToolMessage
                messages.append(ToolMessage(content=result, tool_call_id=tool_call["id"]))


if __name__ == "__main__":
    run_agent()
