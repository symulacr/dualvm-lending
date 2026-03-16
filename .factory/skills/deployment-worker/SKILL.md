---
name: deployment-worker
description: Deploys contracts to Polkadot Hub TestNet, runs live smoke tests, verifies on explorer, and manages deployment manifests.
---

# Deployment Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features that involve:
- Deploying contracts to Polkadot Hub TestNet
- Running live smoke/proof scripts against the testnet
- Explorer verification via Blockscout
- PVM probe deployment and proof collection
- Live migration execution
- Writing or updating deployment manifests in `dualvm/deployments/`

## Work Procedure

1. **Read the feature description** and identify what needs to be deployed/verified.

2. **Check prerequisites**:
   - `.env` exists with required private keys (read `.env.example` for the template)
   - Funded wallet has sufficient PAS balance: `cd /home/kpa/polkadot/dualvm && node scripts/check-testnet-balance.mjs`
   - Contracts compile: `cd /home/kpa/polkadot/dualvm && npx hardhat compile`
   - For PVM ops: `cd /home/kpa/polkadot/dualvm && npm run build:pvm:probes`

3. **Deploy using existing scripts** when possible:
   - Standard deployment: `cd /home/kpa/polkadot/dualvm && npx hardhat run scripts/deploy.ts --network polkadotHubTestnet`
   - Governed deployment: `cd /home/kpa/polkadot/dualvm && npx hardhat run scripts/deployGoverned.ts --network polkadotHubTestnet`
   - PVM probes: `cd /home/kpa/polkadot/dualvm && HARDHAT_CONFIG=hardhat.pvm.config.ts npx hardhat run scripts/probes/deploy-pvm-probes.ts --network polkadotHubPvmTestnet`
   - Modify scripts if the feature requires new deployment logic

4. **Run live smoke tests** to prove deployment works:
   - Borrow: `cd /home/kpa/polkadot/dualvm && npx hardhat run scripts/liveSmoke.ts --network polkadotHubTestnet`
   - Repay: `cd /home/kpa/polkadot/dualvm && npx hardhat run scripts/liveRepaySmoke.ts --network polkadotHubTestnet`
   - Liquidation: `cd /home/kpa/polkadot/dualvm && npx hardhat run scripts/liveLiquidationSmoke.ts --network polkadotHubTestnet`

5. **Verify contracts on Blockscout**:
   - `cd /home/kpa/polkadot/dualvm && npx hardhat run scripts/verifyAll.ts --network polkadotHubTestnet`
   - Check each contract address on `https://blockscout-testnet.polkadot.io/` source tab

6. **Write manifest and results files** to `dualvm/deployments/`

7. **IMPORTANT: Be conservative with RPC calls.** Public testnet is rate-limited. Space out transactions. If you get 429 errors, wait 30+ seconds before retrying.

8. **Run local tests** to ensure nothing broke: `cd /home/kpa/polkadot/dualvm && npm test`

9. **Commit** manifests, results files, and any script changes.

## Example Handoff

```json
{
  "salientSummary": "Deployed consolidated governance system to Polkadot Hub TestNet. GovernanceToken at 0xABC..., DualVMGovernor at 0xDEF..., TimelockController at 0x123.... Ran borrow/repay smoke successfully. All 9 contracts verified on Blockscout. Manifest written to deployments/polkadot-hub-testnet-canonical.json.",
  "whatWasImplemented": "Full consolidated deployment with Governor governance root. Fresh PvmQuoteProbe deployed via resolc. Probe proof re-run (all 4 stages passed). Borrow/repay/liquidation smokes passed. Explorer verification complete. Canonical manifest and results files written.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {"command": "npx hardhat run scripts/deployGoverned.ts --network polkadotHubTestnet", "exitCode": 0, "observation": "All contracts deployed, manifest written"},
      {"command": "npx hardhat run scripts/liveSmoke.ts --network polkadotHubTestnet", "exitCode": 0, "observation": "Borrow flow succeeded, tx: 0x..."},
      {"command": "npx hardhat run scripts/verifyAll.ts --network polkadotHubTestnet", "exitCode": 0, "observation": "All contracts verified"}
    ],
    "interactiveChecks": [
      {"action": "Checked LendingCore on Blockscout", "observed": "Source tab shows verified Solidity code"}
    ]
  },
  "tests": {"added": []},
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Deployment fails due to insufficient funds (need faucet)
- RPC is down or consistently returning 429s
- Verification fails on Blockscout (may need different approach)
- Contract requires code changes (solidity-worker handles that)
- Need new wallet addresses generated and funded
