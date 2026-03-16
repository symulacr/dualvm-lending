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
