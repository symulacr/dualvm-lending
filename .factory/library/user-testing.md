# User Testing

Testing surface, tools, and resource cost classification.

---

## Validation Surface

### Browser Frontend
- **URL:** Vercel-hosted (primary), eyawa.me (backup), localhost:5173 (dev)
- **Tool:** agent-browser
- **Capabilities:** wallet connect (RainbowKit/MetaMask), deposit, borrow, repay, liquidate, market snapshot view, observer mode
- **Setup:** Start vite dev server (`cd dualvm && npx vite --port 5173`), or use hosted URL
- **Auth:** MetaMask wallet with funded account on Polkadot Hub TestNet (chain ID 420420417)
- **Limitations:** Public RPC may be slow or rate-limited; recent-events may fall back to snapshot

### Terminal / Script Operations
- **Tool:** Execute commands
- **Capabilities:** Hardhat tests, smoke scripts, deployment, verification, probe execution
- **Setup:** `cd dualvm && npm ci` + `.env` configuration
- **Auth:** Private keys in `.env` for live operations

## Validation Concurrency

### agent-browser
- Machine: 12 cores, 7.8 GB RAM, ~4.5 GB available
- Vite dev server: ~200 MB
- Each agent-browser instance: ~300 MB
- Max concurrent at 70% headroom: (4.5 GB * 0.7) / 300 MB ≈ **10**, capped at **5** (practical limit)
- **Max concurrent validators: 5**

### Terminal operations
- Hardhat tests: ~500 MB, single-threaded
- Max concurrent: **3** (conservative for RPC rate limits)

### Terminal / Hardhat validation
- Hardhat compile + targeted test runs touch shared `artifacts/` and `cache/` state, so practical concurrency for governance-overhaul validation is **2** only when using `--no-compile` after a single warm-up compile.
- If a validator needs compilation, serialize it behind the warm-up compile instead of running compiles in parallel.

### Terminal / live on-chain reads
- Public RPC reads against Polkadot Hub TestNet are lightweight, but repeated contract calls and explorer lookups can still trigger rate limits.
- During the `contract-architecture-hardening` run, scripted requests to the primary ETH RPC and Blockscout API returned HTTP 403 from this environment; the documented fallback RPC `https://services.polkadothub-rpc.com/testnet/` worked for sparse batched receipt checks.
- **Max concurrent validators: 2** for read-heavy live validation batches.

### Terminal / doc audit
- Repo-local documentation audits (README/SPEC/features/status/docs tree/git history) are CPU-light and do not depend on shared network state.
- They can run concurrently as long as validators remain read-only and do not trigger compiles or builds.
- **Max concurrent validators: 2** for this surface so evidence collection stays easy to attribute.

### Explorer / hosted web surfaces
- Blockscout and hosted frontend pages are safe to inspect concurrently, but they depend on public infrastructure and can intermittently stall.
- Blockscout may return `429` responses and still display source from a verified twin while labeling the deployed address itself as unverified; check the page banner and `/api/v2/smart-contracts/<address>` `is_verified` field instead of trusting the code pane alone.
- **Max concurrent validators: 2** for browser/API evidence collection.

### Browser frontend write-path (current run adjustment)
- Current machine state during the `frontend-write-path` validation run showed only ~280 MB available RAM.
- Even though the steady-state browser guidance above allows more concurrency, for this run the safe ceiling is **1 concurrent browser validator**.
- Keep the write-path lifecycle in a single browser session so wallet state, approval state, and recent-activity refreshes stay isolated and deterministic.

## Flow Validator Guidance: terminal-hardhat

- **Surface:** Local Hardhat terminal workflow in `/home/kpa/polkadot/dualvm`
- **Primary commands:** `npx hardhat compile`, then targeted `npx hardhat test --no-compile --grep "..."` or `npx hardhat test --no-compile test/<file>.ts`
- **Isolation boundary:** Validators may read shared project sources and run read/compile/test commands only. They must not edit code, rewrite `.env`, delete caches, or kill shared processes.
- **Shared-state rule:** Assume `artifacts/` and `cache/` are shared. Use the precompiled artifacts prepared by the parent validator and prefer `--no-compile` to avoid collisions.
- **Evidence rule:** Record the exact test commands run, the named test cases that passed, and any concrete values/assertions observed directly from terminal output or test code paths.
- **Rename audits:** When validating source renames, scope the assertion to active source roots (`contracts/`, `lib/`, `scripts/`, `test/`). Generated outputs and historical critique/docs can preserve legacy names and should not be treated as current source-of-truth.
- **Safe parallelism:** At most 2 concurrent validators on this surface for this machine state; batch additional validators after the first wave completes.

## Flow Validator Guidance: terminal-live-onchain

- **Surface:** Read-only validation against the live Polkadot Hub TestNet deployment from `/home/kpa/polkadot/dualvm`.
- **Primary tools:** `node`, `viem`, `curl`, `python3`, existing deployment/result JSON artifacts, and read-only RPC calls.
- **Historical reads:** When validating past state on this RPC surface, prefer raw `eth_call` with an explicit hex block tag over higher-level helpers that may coerce block references unreliably.
- **Isolation boundary:** Validators may read repo files, query public RPC/explorer endpoints, and inspect existing tx hashes. They must not submit new on-chain transactions, edit code, alter `.env`, or mutate shared deployment artifacts.
- **Shared-state rule:** Treat the public RPC as shared and rate-limited. Batch related contract reads in one script where practical and avoid tight retry loops.
- **Evidence rule:** Record the exact command(s) run, the addresses/tx hashes used, and the concrete values observed from live calls or receipts.
- **Safe parallelism:** At most 2 concurrent validators on this surface for this machine state.

## Flow Validator Guidance: explorer-blockscout

- **Surface:** Blockscout and other hosted HTTP surfaces for the canonical Polkadot Hub TestNet deployment.
- **Primary tools:** `agent-browser` for page-level checks and screenshots, or `curl`/HTTP fetches for explorer/API responses when screenshots are unnecessary.
- **Verification caveat:** On Blockscout, a deployed address can show source from a same-bytecode twin yet still be unverified at that exact address. Treat the address as verified only if the page banner/source tab and API status agree.
- **Isolation boundary:** Validators may browse/read hosted pages only. They must not log into services, submit forms, or trigger writes.
- **Shared-state rule:** Use the canonical manifest and verification artifact as the source of addresses to inspect; do not test unrelated contracts.
- **Evidence rule:** Capture the exact URL(s) checked and whether source/contract pages, HTTP status, or API payloads matched the expected verification claim.
- **Safe parallelism:** At most 2 concurrent validators on this surface for this machine state.

## Flow Validator Guidance: terminal-doc-audit

- **Surface:** Read-only repository audit for documentation and narrative assertions in `/home/kpa/polkadot` and `/home/kpa/polkadot/dualvm`.
- **Primary tools:** `Read`, `Grep`, `Glob`, `git` read commands, and lightweight shell/Python inspection commands.
- **Isolation boundary:** Validators may inspect tracked files, mission metadata, and git history/diff output only. They must not edit files, run destructive git commands, or modify generated artifacts.
- **Shared-state rule:** Treat the working tree as shared. Do not stage, commit, clean, or rewrite files from a flow validator.
- **Assertion strategy:** Group related file-content checks together (README/SPEC/features/status/submission/doc-tree) and capture exact strings, file paths, and quantitative diff evidence directly from command output.
- **Evidence rule:** Record every file path inspected, every search pattern used, and the concrete matching or non-matching output that proves the assertion.
- **Safe parallelism:** At most 2 concurrent validators on this surface.

## Flow Validator Guidance: browser-frontend

- **Surface:** Browser validation of the DualVM Lending frontend on the hosted URL `http://eyawa.me/dualvm-lending/` and, if needed, a local preview URL provided by the parent validator.
- **Primary tool:** `agent-browser`.
- **Isolation boundary:** Use exactly one dedicated browser session for the assigned assertion group. Do not share wallet state across subagents. Do not open additional browser sessions unless explicitly assigned.
- **Wallet boundary:** If wallet connection is possible, keep all multi-step write actions (wrap, approve, deposit, borrow, repay, withdraw, liquidate) in the same session so transaction state and form history remain coherent. Do not import, reveal, or persist private keys outside the browser/wallet flow.
- **Shared-state rule:** The live deployment and public RPC are shared, rate-limited infrastructure. Avoid repeated hard refreshes, retry loops, or duplicate transaction submissions. Record blockers instead of brute-forcing through transient failures.
- **Assertion strategy:** Capture read-only evidence first (page load, connect button, market snapshot, observer mode, active/latest version cards), then proceed through the write-path lifecycle and verify pending/confirmed banners plus Blockscout links for each step.
- **Evidence rule:** Save screenshots for visible states and include exact transaction hashes / explorer URLs for confirmed writes when available.
- **Safe parallelism:** **1** concurrent validator for this surface in the current run.

## Browser Frontend Run Notes

- `http://eyawa.me/dualvm-lending/` is currently reachable (`HTTP 200`) but serves an older observer-only build. It is good for hosted-access checks, not for validating the latest write-path UI.
- `http://localhost:5173/` served the current local frontend successfully and exposed the latest read-layer/version cards plus the `Connect Wallet` button during the `frontend-write-path` validation run.
- During the `frontend-ux-overhaul` validation run, `http://localhost:5173/` returned `ERR_CONNECTION_REFUSED`; the already-running preview at `http://localhost:4175/` returned `HTTP 200` and was used as the non-disruptive fallback for tab/observer assertions.
- In that same run, wallet-dependent browser validation was blocked because no usable wallet path completed inside the isolated browser session:
  - `MetaMask` did not establish a connected account.
  - `Base Account` redirected to Coinbase Keys onboarding.
  - `WalletConnect`/Reown emitted remote-config `403/400` failures and websocket `3000 Unauthorized: invalid key` errors.
- Treat those wallet-connect diagnostics as the first thing to re-check before re-running browser write validation.

## Repo Setup Notes

- `.factory/init.sh` still invokes plain `npm test`, which can fail with `/tmp` `ENOSPC` on this machine.
- For validation runs, prefer `.factory/services.yaml` `commands.test` (`cd dualvm && TMPDIR=/var/tmp npm test`) or export `TMPDIR=/var/tmp` before direct test commands.

## Stabilize-Connect-DeRisk Run Notes

- The stale oracle issue (oracle stuck at 50 USDC/PAS after prior smoke run) was fixed in `v2-liquidation-reproof`. The `liveV2Smoke.ts` script now refreshes the oracle at its current price when stale (exploiting the fact that `setPrice(currentPrice)` skips the delta circuit breaker check). The fresh oracle enables the successful liquidation TX.
- `liveV2Smoke-results.json` as of 2026-03-19 contains clean evidence:
  - Liquidation TX `0x6abcbb2ea76f3bbe921920f3d29366e8156efe531d99b68c616567ff29feb4fd` — confirmed SUCCESS (not reverted); debt 276 → 0 USDC, 5.796 WPAS seized.
  - XCM notifier TX `0x8cc460b84bd837297c861b92c57104b2ef99c0fa6cfcf25e34b69768eaa40e7e` — confirmed SUCCESS; LiquidationNotified event emitted.
  - Steps 1-3 (deposit/borrow/repay) TX hashes preserved from the first run: `0x694e7c6c...`, `0x8646df1...`, `0x4c1bd8b...`.
- `liveV2Smoke.ts` proves the V2 lifecycle across two scripted positions: borrower `0x222a2a8a203b4146f6036F1E08e86C9B85063b70` is used for deposit/borrow/repay, while admin borrower `0x36a83a4450744f4F9988c9Bc46cC556Ba5bFD2dF` is used for the dedicated liquidation segment. Validate `VAL-CROSS-M9-001` from the combined script evidence rather than expecting one address to perform every step.
- The ManualOracle circuit breaker is 25% max price change per call (maxPriceChangeBps=2500). Attempting to call `setCircuitBreaker(min, max, 0)` through AccessManager execute may revert on testnet (observed failure, root cause unclear). Use the same-price refresh technique instead for oracle staleness fixes.
- `liveV2Smoke-results.json` step-5 migration-path text uses outdated function names/signatures. Reconfirm the current V1→V2 route against `contracts/migration/MarketMigrationCoordinator.sol` and `deployments/polkadot-hub-testnet-migration-proof.json` instead of relying only on that narrative block.
