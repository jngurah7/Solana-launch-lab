---
name: Solana Launch Lab safety
description: Product-wide wallet, trading, and market-data constraints.
---

Never request or store recovery phrases or wallet private keys. Live trading must remain off by default, and real transactions require explicit wallet approval. Keep Devnet and Mainnet clearly separated. Never invent token prices or market data. The initial paper-trading budget is A$100, with configurable trade limits and daily loss protection.

**Why:** the user explicitly set these requirements for Solana Launch Lab.

**How to apply:** preserve these constraints in wallet, market-data, token-risk, paper-trading, portfolio, and transaction features.

For the read-only Phantom flow, persist only the public wallet address and mark it unverified after app restart until Phantom approves again. Keep the app-generated response-decryption secret in device secure storage for at most five minutes so Android can resume the callback after recreating the JS process, then delete it. Do not persist Phantom's signing session token while the app has no signing features.

**Why:** Android may recreate the app while Phantom is foregrounded; a saved address is not proof of a current Phantom approval, and the read-only screen does not need signing authorization.

**How to apply:** keep handshake secrets short-lived and separate from wallet keys; only show a verified connection after a fresh, successfully decrypted Phantom approval.
