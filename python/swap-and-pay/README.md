# Swap-and-Pay

Pay in USDC even when the vault only holds WETH. The relayer swaps automatically.

**Key pattern:** The bot always pays in the token the recipient expects. If the vault doesn't hold that token, the relayer finds a Uniswap route, swaps the exact amount needed, and sends the payment — all in one transaction. The bot doesn't need to know which tokens the vault holds.

## How it works

1. Bot calls `pay(to, token='USDC', amount=5)` — a normal payment request
2. Relayer checks vault balance — not enough USDC
3. Relayer finds WETH in the vault, gets a Uniswap quote (WETH -> USDC)
4. Relayer calls `executePayment()` with swap params attached
5. Vault swaps WETH -> USDC and sends USDC to the recipient in one transaction

The bot code is identical to a direct payment — swap routing is fully transparent.

## Setup

```bash
pip install -r requirements.txt
cp .env.example .env   # add vault address and bot key
```

Fund the vault with **WETH** (not USDC) to force the swap route. On Base Sepolia, wrap ETH by sending it to the WETH contract:

```bash
cast send 0x4200000000000000000000000000000000000006 --value 0.01ether --private-key <OWNER_KEY> --rpc-url https://sepolia.base.org
# Then deposit WETH into the vault
```

## Usage

```bash
python pay.py               # pay 0.01 USDC (default)
python pay.py 5              # pay 5 USDC
python pay.py balance        # check WETH + USDC balances
```
