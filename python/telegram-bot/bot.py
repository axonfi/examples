"""Telegram bot with Axon vault payments.

A Telegram bot that lets authorized users send payments, check balances, and
manage an Axon vault — all through chat commands.

Usage:
    pip install -r requirements.txt
    cp .env.example .env
    python bot.py
"""

import json
import logging
import os
import sys

from dotenv import load_dotenv
from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes

from axonfi import AxonClientSync, Chain, KNOWN_TOKENS, resolve_token

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# ── Configuration ────────────────────────────────────────────────────────────

TELEGRAM_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
ALLOWED_USERS = set(os.environ.get("ALLOWED_TELEGRAM_USERS", "").split(","))
CHAIN_ID = int(os.environ.get("AXON_CHAIN_ID", str(Chain.BaseSepolia)))


def _load_bot_key() -> str:
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


axon = AxonClientSync(
    vault_address=os.environ["AXON_VAULT_ADDRESS"],
    chain_id=CHAIN_ID,
    bot_private_key=_load_bot_key(),
)


# ── Auth ─────────────────────────────────────────────────────────────────────

def authorized(func):
    """Only allow whitelisted Telegram users."""
    async def wrapper(update: Update, context: ContextTypes.DEFAULT_TYPE):
        username = update.effective_user.username or ""
        if ALLOWED_USERS and ALLOWED_USERS != {""} and username not in ALLOWED_USERS:
            await update.message.reply_text("Not authorized.")
            logger.warning(f"Unauthorized access attempt by @{username}")
            return
        return await func(update, context)
    return wrapper


# ── Commands ─────────────────────────────────────────────────────────────────

@authorized
async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "Axon Vault Bot\n\n"
        "Commands:\n"
        "/balance [token] — Check vault balance\n"
        "/pay <address> <amount> [token] [memo] — Send payment\n"
        "/status — Vault status\n"
        "/poll <request_id> — Check pending payment\n"
        "/help — Show this message"
    )


@authorized
async def cmd_balance(update: Update, context: ContextTypes.DEFAULT_TYPE):
    token_symbol = context.args[0].upper() if context.args else "USDC"
    try:
        token_address = resolve_token(token_symbol, CHAIN_ID)
        balance_raw = axon.get_balance(token_address)
        token_info = KNOWN_TOKENS.get(token_symbol)
        if token_info:
            human = balance_raw / (10 ** token_info.decimals)
            await update.message.reply_text(f"💰 {human:.4f} {token_symbol}")
        else:
            await update.message.reply_text(f"💰 {balance_raw} (raw) {token_symbol}")
    except Exception as e:
        await update.message.reply_text(f"Error: {e}")


@authorized
async def cmd_pay(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if len(context.args) < 2:
        await update.message.reply_text("Usage: /pay <address> <amount> [token] [memo]")
        return

    to = context.args[0]
    amount = float(context.args[1])
    token = context.args[2].upper() if len(context.args) > 2 else "USDC"
    memo = " ".join(context.args[3:]) if len(context.args) > 3 else None

    if not to.startswith("0x") or len(to) != 42:
        await update.message.reply_text("Invalid address. Must be 0x... (42 chars)")
        return

    await update.message.reply_text(f"Sending {amount} {token} to {to[:8]}...{to[-4:]}")

    try:
        result = axon.pay(to=to, token=token, amount=amount, memo=memo)
        if result.status == "approved":
            await update.message.reply_text(f"✅ Sent! TX: {result.tx_hash}")
        elif result.status == "pending_review":
            await update.message.reply_text(
                f"⏳ Under review\nRequest: {result.request_id}\nUse /poll {result.request_id}"
            )
        else:
            await update.message.reply_text(f"❌ Rejected: {result.reason}")
    except Exception as e:
        await update.message.reply_text(f"Error: {e}")


@authorized
async def cmd_status(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        info = axon.get_vault_info()
        paused = axon.is_paused()
        active = axon.is_active()

        status = "🟢 Active" if active and not paused else "🔴 Paused" if paused else "⚠️ Inactive"
        await update.message.reply_text(
            f"Vault: {axon.vault_address[:8]}...{axon.vault_address[-4:]}\n"
            f"Bot: {axon.bot_address[:8]}...{axon.bot_address[-4:]}\n"
            f"Status: {status}\n"
            f"Owner: {info.get('owner', 'unknown')[:8]}..."
        )
    except Exception as e:
        await update.message.reply_text(f"Error: {e}")


@authorized
async def cmd_poll(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text("Usage: /poll <request_id>")
        return

    try:
        result = axon.poll(context.args[0])
        if result.status == "approved":
            await update.message.reply_text(f"✅ Approved! TX: {result.tx_hash}")
        elif result.status == "pending_review":
            await update.message.reply_text("⏳ Still under review")
        else:
            await update.message.reply_text(f"❌ {result.status}: {result.reason}")
    except Exception as e:
        await update.message.reply_text(f"Error: {e}")


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    logger.info(f"Starting Axon Telegram Bot")
    logger.info(f"Vault: {axon.vault_address}")
    logger.info(f"Bot: {axon.bot_address}")
    logger.info(f"Allowed users: {ALLOWED_USERS}")

    app = Application.builder().token(TELEGRAM_TOKEN).build()

    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("help", cmd_start))
    app.add_handler(CommandHandler("balance", cmd_balance))
    app.add_handler(CommandHandler("pay", cmd_pay))
    app.add_handler(CommandHandler("status", cmd_status))
    app.add_handler(CommandHandler("poll", cmd_poll))

    app.run_polling()


if __name__ == "__main__":
    main()
