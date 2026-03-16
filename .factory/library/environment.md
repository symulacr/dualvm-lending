# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** Required env vars, external API keys/services, dependency quirks, platform-specific notes.
**What does NOT belong here:** Service ports/commands (use `.factory/services.yaml`).

---

## Network Configuration
- Primary RPC: `https://eth-rpc-testnet.polkadot.io/`
- Fallback RPC: `https://services.polkadothub-rpc.com/testnet/`
- Chain ID: `420420417`
- Explorer: `https://blockscout-testnet.polkadot.io/`
- WSS (PVM ops): `wss://asset-hub-paseo-rpc.n.dwellir.com`
- Faucet: `https://faucet.polkadot.io/`

## Wallet
- Funded wallet file: `dualvm/wallets/polkadot-hub-testnet-wallet-2026-03-16T04-46-12-085Z.txt`
- Address: `0x36a83a4450744f4F9988c9Bc46cC556Ba5bFD2dF`
- Additional wallets may be needed for Governor owners — generate via `npm run wallet:generate` in dualvm/

## Environment Variables (.env)
- `.env` is gitignored, `.env.example` is the template
- Key variables: PRIVATE_KEY, POLKADOT_HUB_TESTNET_RPC_URL, role-specific keys
- DEPLOYMENT_MANIFEST_PATH controls which manifest scripts use (default: baseline)
- Frontend does NOT use DEPLOYMENT_MANIFEST_PATH — it statically imports from `src/lib/manifest.ts`

## Dependencies
- Node.js 18+, npm
- Hardhat with @nomicfoundation/hardhat-toolbox
- @parity/hardhat-polkadot for PVM compilation
- @polkadot/api for substrate RPC (PVM probe operations)
- Foundry (optional secondary compiler, `foundry.toml`)
