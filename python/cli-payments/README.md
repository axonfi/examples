# CLI Payments

## What it does

Venmo from the command line. Send USDC, check your balance, poll payment status — all from the terminal.

This is the **simplest possible Axon integration** (~80 lines of Python). Good for testing your vault setup or scripting payments.

**Chain:** Base Sepolia (testnet, free)
**Token:** USDC (or any token in the vault)

## Commands

```bash
# Send 1.50 USDC to an address
python cli.py pay 0x000000000000000000000000000000000000dEaD USDC 1.5 --memo "Test payment"

# Check how much USDC is in the vault
python cli.py balance USDC

# Check if a pending payment went through
python cli.py poll abc123-request-id

# Is my bot registered and active?
python cli.py status
```

## Example Output

```
$ python cli.py status
Bot: 0xda964c6C53394d9d9E49DfA29C2db39aB74fC74F
Active: True
Vault paused: False

$ python cli.py balance USDC
95.500000 USDC

$ python cli.py pay 0x...dead USDC 5 --memo "Invoice #42"
Paying 5.0 USDC to 0x...dead...
Status: approved
TX: 0xabc123...

$ python cli.py balance USDC
90.500000 USDC
```

## Setup

```bash
pip install -r requirements.txt
cp .env.example .env  # Fill in AXON_VAULT_ADDRESS, AXON_BOT_PRIVATE_KEY
python cli.py status   # Verify it works
```
