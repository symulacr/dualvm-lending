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
- `node scripts/check-testnet-balance.mjs` requires an explicit EVM address argument; invoking it with no address only prints usage.

## Environment Variables (.env)
- `.env` is gitignored, `.env.example` is the template
- Key variables: PRIVATE_KEY, POLKADOT_HUB_TESTNET_RPC_URL, role-specific keys
- DEPLOYMENT_MANIFEST_PATH controls which manifest scripts use (default: `dualvm/deployments/polkadot-hub-testnet-canonical.json`)
- Frontend does NOT use DEPLOYMENT_MANIFEST_PATH — it statically imports from `src/lib/manifest.ts`
- Role-specific keys can diverge from the deployer signer. If `EMERGENCY_PRIVATE_KEY` is a different account, governed-role cleanup must explicitly revoke/renounce EMERGENCY from that holder; revoking only the deployer is insufficient.

## Dependencies
- Node.js 18+, npm
- Hardhat with @nomicfoundation/hardhat-toolbox
- @parity/hardhat-polkadot for PVM compilation
- @polkadot/api for substrate RPC (PVM probe operations)
- Foundry (optional secondary compiler, `foundry.toml`)

## Frontend Validation Notes
- `dualvm/src/lib/wagmiConfig.ts` currently hardcodes the placeholder Reown/WalletConnect project ID `DUALVM_LENDING_HACKATHON`; injected wallet / MetaMask flows still work, but WalletConnect-style modal options can fail and emit expected 400/403 console noise until a real project ID is supplied.
- On this machine, `npx vite build` may run out of memory for the frontend; if that happens, retry with `NODE_OPTIONS='--max-old-space-size=1024' npx vite build`.

## Validator Environment Notes
- On this machine, `/tmp` is currently a full tmpfs. Validators that create temporary files (notably `cd dualvm && npm test`) should be run with `TMPDIR=/var/tmp` to avoid `ENOSPC` failures from `os.tmpdir()`-based tests.

## M11 Canonical Deployment (2026-03-19)
- All 17 EVM contracts deployed to Polkadot Hub TestNet (chain 420420417)
- **CRITICAL deployment flags**: `--legacy --gas-estimate-multiplier 500 --slow` are REQUIRED
  - Polkadot Hub TestNet rejects EIP-1559 (type 2) transactions for smaller contracts
  - Gas estimation underestimates by ~5x for some contracts (XcmLiquidationNotifier, XcmNotifierAdapter)
- **Foundry profile**: Use `FOUNDRY_PROFILE=deploy` (via_ir=false, evm_version=cancun)
- PVM DeterministicRiskModel: `0xC6907B609ba4b94C9e319570BaA35DaF587252f8`
- Key deployed addresses (manifest: `dualvm/deployments/deploy-manifest.json`):
  - AccessManager: `0xc7F5871c0223eE42A858b54a679364c92C8CB0E8`
  - LendingEngine: `0x74924a4502f666023510ED21Ae6E27bC47eE6485`
  - RiskGateway: `0x01E56920355f1936c28A2EA627D027E35EccBca6`
  - DebtPool: `0x1A024F0232Bab9D6282Efbf533F11e11511d68a8`
  - TimelockController: `0x9e1a91042bAd90b73D4d35e798D140C83e0D45D5`
  - DualVMGovernor: `0xD8bA49b5d6e3DF55B7a4424E1F6D0b3C22625220`
  - GovernanceToken: `0x9D6d874413c72284514d5511A810DCeeDaB75a11`
- Deployer has NO admin roles (fully renounced post-deployment)
