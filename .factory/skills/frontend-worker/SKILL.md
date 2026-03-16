---
name: frontend-worker
description: Implements React frontend components, wallet integration, and UI/UX for the DualVM Lending dApp.
---

# Frontend Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features that involve:
- React components in `dualvm/src/`
- Wallet connection (wagmi, RainbowKit)
- Frontend write-path forms (deposit, borrow, repay, liquidate)
- Frontend read-model updates
- CSS/styling changes
- Vite configuration
- Frontend dependency additions

## Work Procedure

1. **Read the feature description** and identify what UI changes are needed.

2. **Read existing frontend code** before writing:
   - `dualvm/src/App.tsx` — main app structure
   - `dualvm/src/lib/manifest.ts` — deployment manifest import
   - `dualvm/src/lib/readModel/` — existing blockchain read patterns
   - `dualvm/src/lib/abi.ts` — existing ABI definitions
   - `dualvm/src/components/sections/` — existing section components
   - `dualvm/vite.config.ts` — build configuration
   - `dualvm/package.json` — current dependencies

3. **Install dependencies** if needed:
   - `cd /home/kpa/polkadot/dualvm && npm install wagmi @rainbow-me/rainbowkit @tanstack/react-query`
   - Always check package.json first to avoid duplicates

4. **Write components** following existing patterns:
   - Functional React components
   - Use existing `src/lib/` patterns for chain reads
   - For writes: use wagmi hooks (`useWriteContract`, `useWaitForTransactionReceipt`)
   - For wallet: use RainbowKit `ConnectButton` and wagmi `useAccount`
   - Match existing CSS patterns in `src/style.css`

5. **Test the frontend**:
   - Build: `cd /home/kpa/polkadot/dualvm && npx vite build`
   - TypeCheck: `cd /home/kpa/polkadot/dualvm && npx tsc --noEmit`
   - If tests exist for frontend modules: `cd /home/kpa/polkadot/dualvm && npm test`

6. **Manually verify** by starting dev server and checking:
   - `cd /home/kpa/polkadot/dualvm && npx vite --port 5173`
   - Check that pages load without console errors
   - Check that wallet connection button renders
   - Check that forms render and accept input

7. **Commit** all frontend changes.

## Example Handoff

```json
{
  "salientSummary": "Added wagmi + RainbowKit wallet connection and full write-path forms (deposit, borrow, repay, liquidate). ConnectButton renders in header. All forms submit transactions via useWriteContract. TX confirmation shows Blockscout link. Vite build succeeds. TypeCheck clean.",
  "whatWasImplemented": "src/lib/wagmiConfig.ts (chain config), src/components/ConnectWallet.tsx (RainbowKit wrapper), src/components/sections/WritePathSection.tsx (deposit/borrow/repay/liquidate forms), updated src/App.tsx to include wallet provider and write section, updated src/lib/abi.ts with write ABIs, updated package.json with wagmi/rainbowkit/react-query",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {"command": "cd /home/kpa/polkadot/dualvm && npx vite build", "exitCode": 0, "observation": "Build succeeded"},
      {"command": "cd /home/kpa/polkadot/dualvm && npx tsc --noEmit", "exitCode": 0, "observation": "No type errors"}
    ],
    "interactiveChecks": [
      {"action": "Started vite dev server and opened localhost:5173", "observed": "Page loads, ConnectButton visible, no console errors"},
      {"action": "Clicked Connect and selected MetaMask", "observed": "Wallet connected, address shown"},
      {"action": "Filled deposit form and submitted", "observed": "Transaction sent, pending indicator shown"}
    ]
  },
  "tests": {"added": []},
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- wagmi/RainbowKit has compatibility issues with vite (polyfills needed)
- Manifest import points to wrong deployment (need orchestrator to confirm canonical manifest)
- ABI definitions are missing for contract functions needed by the UI
- Feature requires contract changes (solidity-worker handles that)
