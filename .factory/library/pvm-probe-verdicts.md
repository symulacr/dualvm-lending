## PVM probe verdicts

- Authoritative raw artifact: `dualvm/deployments/polkadot-hub-testnet-probe-results.json`
- Current raw stage statuses in that artifact:
  - `stage0`: passed
  - `stage1Echo`: passed
  - `stage1Quote`: passed
  - `stage2`: failed (`No defensible live PVM->REVM callback was proven on-chain.`)
  - `stage3`: failed (`No defensible REVM settlement state mutation depending on a PVM-derived quote was proven.`)
- The same JSON also contains `verdicts: { A: true, B: true, C: true, D: false }` and a top-level `finalSummary` that says roundtrip settlement was demonstrated. Treat that file as internally inconsistent.
- For docs and reviews, do **not** describe callback or roundtrip settlement as unambiguously passed standalone probe stages unless you also explain the contradiction/override context from the broader validation record.
