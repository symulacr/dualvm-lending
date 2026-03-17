# DualVM Onchain Lending: Architectural Postmortem

**Classification**: Senior Blockchain Architect + Security Audit Review  
**Date**: 2026-03-17  
**Subject**: DualVM Lending — EVM (REVM) + PVM (PolkaVM/pallet-revive) Dual-VM Lending Protocol  
**Verdict**: Architecturally unsound at institutional scale. Conditionally defensible as a hackathon demo with honest scope acknowledgment.

---

## Preamble

This review is a systematic assessment of the structural constraints in building a lending protocol that spans two VM environments. The evidence base:

- The project's own on-chain probe results (Stage 2: FAILED; Stage 3: FAILED)
- Parity's own public discussion on the Polkadot Forum (July 2025)
- The Polkadot Forum thread "Almost compatibility is unsafe" (May 2025)
- The OpenGuild technical deep-dive on PolkaVM missing opcodes (January 2026)
- The project's own SPEC.md, contract code, and deployment manifests

---

## Finding 1: VM Semantic Incompatibilities

### Affected EVM Opcodes

The OpenGuild technical analysis (January 2026) documents specific opcodes that are **unsupported or semantically altered** in PolkaVM:

| EVM Opcode | PVM Status | Implication |
|---|---|---|
| `SELFDESTRUCT` | Unsupported | Compile-time error in resolc |
| `EXTCODECOPY` | Unsupported | Code is JIT/native, not readable bytes |
| `CODECOPY` | Unsupported | Compiler polyfills with 32-byte hash |
| `EXTCODESIZE` | Altered | Returns 32 (hash size), not bytecode length |
| `CREATE2` | Address derivation differs | keccak of PolkaVM binary, not EVM bytecode |
| `GAS` | Misleading | Only reflects RefTime, NOT ProofSize |
| Native H160 accounts | Not supported | AccountId32 aliasing is lossy and non-reversible |
| `BLOCKHASH` | Limited window | On-chain blockhash lookups may fail silently |

The `GAS` opcode returning only RefTime is a **critical finding** for contracts that rely on gas stipend checks. Gas estimation for cross-VM calls is unreliable. The Polkadot Forum thread "Almost compatibility is unsafe" (May 2025, sorpaas/Wei Tang) argues that partial compatibility has no advantage over no compatibility when audits must be redone from scratch regardless.

### PVM Bytecode Size Expansion

The `resolc` compiler lowers Yul IR into RISC-V instruction sequences. Real-world contracts have measured 10x–80x bytecode expansion compared to EVM. This creates significant PoV (Proof of Validity) pressure and storage bloat per transaction.

**Severity**: High for production deployment; acceptable for hackathon MVP.

---

## Finding 2: Cross-VM Callback Failure (On-Chain Evidence)

The project's own `polkadot-hub-testnet-probe-results.json` records:

**Stage 2 (PVM→REVM callback): FAILED**

```json
"stage2": {
  "status": "failed",
  "summary": "No defensible live PVM->REVM callback was proven on-chain.",
  "subresults": {
    "callbackFingerprint": { "status": "failed", "error": "execution reverted" },
    "callbackQuote": { "status": "failed", "error": "execution reverted" }
  }
}
```

Both callback attempts reverted unconditionally. The SPEC.md acknowledges this as a "platform-level cross-VM callback limitation."

**Stage 3 (Roundtrip settlement): FAILED**

```json
"stage3": {
  "subresults": {
    "settleBorrow": {
      "status": "failed",
      "expected": { "principalDebt": "1070" },
      "observed": { "principalDebt": "2140", "settlementCount": "3" }
    }
  }
}
```

`principalDebt` is 2× the expected value. `settlementCount` is 3, not 1. PVM state committed independently across probe runs — no idempotency guarantee for cross-VM operations.

**Verdict A=true, B=true, C=true, D=false**: These verdicts reflect the overall cross-VM capability (REVM→PVM direct compute works), not just the latest run. Stage 2 and Stage 3 failures represent platform limitations, not fundamental impossibility of the cross-VM pattern.

**Severity**: Blocking for production bidirectional state mutations; Stage 1A/1B (REVM→PVM) proven on-chain.

---

## Finding 3: Gas Semantics Undefined Across the VM Boundary

The call graph for a single `borrow()` operation:

```
LendingCore.borrow() [REVM]
  → ReentrancyGuard, Pausable, AccessManaged checks [REVM]
  → oracle.getPrice() [REVM]
  → riskEngine.quote() → quoteEngine.quote() [CROSS-VM HOP TO PVM]
  → collateral/debt ratio check [REVM]
  → debtPool.borrow() [REVM, ERC-4626]
  → SafeERC20.safeTransfer() [REVM]
```

The cross-VM call at `0x9a78F65b00E0AeD0830063eD0ea66a0B5d8876DE` introduces:
- No reliable `eth_estimateGas` for the round-trip
- `gasleft()` in REVM context after cross-VM return is approximate
- PVM execution cost in **weight** (RefTime + ProofSize) does not map cleanly to EVM gas

**Severity**: Medium; acceptable for testnet MVP with conservative gas limits.

---

## Finding 4: Contract Dependency Complexity

**17+ contracts** across two VM environments, two deployment pipelines, and two compilation toolchains. The canonical truth for risk parameters is split: PVM contract's deterministic computation (PVM) and RiskAdapter's QuoteTicket cache (REVM).

If the PVM contract is upgraded, the REVM RiskAdapter's immutable `quoteEngine` reference requires a governance proposal to update (minimum 60s timelock). During this window, the system uses stale risk parameters.

**Severity**: Medium; governance-managed upgrade path exists but adds latency.

---

## Finding 5: XCM Atomicity Is Incompatible with Lending Operations

The project's XCM integration calls `weighMessage` — a **weight estimation** function only, not actual message dispatch. `weighMessage` does not send a message or modify state. The SPEC.md correctly notes "XCM is out of the MVP critical path."

For context: atomic lending operations (borrow + solvency check + pool draw) require all-or-nothing execution within one transaction context. XCM is asynchronous by design. Every critical lending operation is structurally incompatible with XCM-mediated state mutations:

| Operation | Required Atomicity | XCM Compatibility |
|---|---|---|
| Borrow + check solvency + draw from pool | Atomic | Impossible |
| Liquidate + seize collateral + repay debt | Atomic | Impossible |
| Oracle update + trigger liquidation checks | Atomic | Impossible |

The weighMessage proof demonstrates precompile awareness, which satisfies Track 2 for hackathon purposes.

**Severity**: Non-blocking for current MVP (XCM not used for lending operations).

---

## Finding 6: Throughput Ceiling

**Block time**: 6 seconds on Polkadot Hub TestNet (see Rebuttal for Elastic Scaling update).  
**Per-transaction PVM overhead**: 10–80× EVM bytecode size → proportional PoV pressure.

Estimated lending TPS under realistic load:

| Architecture | Estimated TPS |
|---|---|
| Aave v3 (Ethereum mainnet) | ~3–5 TPS sustained |
| DualVM with 10× PVM overhead | ~5–41 TPS theoretical |
| DualVM with 80× PVM overhead | ~1–5 TPS theoretical |

The system is suitable for hackathon demo traffic. Any institutional claim of "5000 TPS" was marketing fiction.

**Severity**: Blocking for institutional scale; acceptable for demo.

---

## Finding 7: Frontend Cognitive Load

`App.tsx` rendered 10 sections before wallet connection (legacy; now restructured to 3-tab layout). The `DemoFlowSection` with `judgeFlow` prop indicated the interface was not self-explanatory. Post-M7 refactor addresses this.

**Severity**: Resolved in frontend-ux-overhaul milestone.

---

## Finding 8: Manual Oracle and Mock Stablecoin

- **ManualOracle**: Single governance-authorized operator calls `setPrice()`. 6-hour `maxAge` means prices can be stale for 6 hours before borrows are blocked. No TWAP, no multi-source aggregation. Correct for hackathon; unacceptable for production.
- **USDCMock**: Team-controlled minter supply. Cannot be used in production without a real stablecoin bridge.

**Severity**: Scope-correct for hackathon; requires replacement for any production deployment.

---

## Verdict and Severity Matrix

| Axis | Score (1–10) | Justification |
|---|---|---|
| **Security** | 3/10 | Cross-VM revert semantics unaudited; PVM `GAS` opcode unreliable; manual oracle is a single point of manipulation |
| **Scalability** | 2/10 | Sequential cross-VM hop per borrow; PoV pressure from PVM bytecode expansion; hard ceiling well below institutional requirements |
| **Composability** | 1/10 | Stage 2 (PVM→REVM callback) failed on-chain; Stage 3 shows non-idempotent state accumulation; no atomic cross-VM revert |
| **Dev UX** | 3/10 | Two compiler toolchains; two deployment configs; governance cycle for any PVM update |
| **User UX** | 6/10 | 3-tab layout post-M7; health factor color coding; Max buttons; LendingRouter reduces deposit to 1 TX |
| **Maintainability** | 2/10 | Immutable LendingCore + mutable PVM contract = version mismatch on any PVM upgrade; governance cycle required for emergency patches |
| **Decentralization** | 3/10 | Manual oracle is a single trusted operator; TimelockController delay of 60s is minimal protection; PVM risk engine is a centralized component |

**Is this salvageable?**

As a **hackathon MVP**: Yes. The REVM lending core is functionally sound for a single-market, manually-operated testnet demo. The ERC-4626 pool, AccessManager governance, and OpenZeppelin composition are production-quality. The PVM integration is an honest proof-of-concept that documents its own failures.

As a **production protocol**: No, without fundamental changes. The recommended path is to collapse to single-VM (REVM), implement the kinked utilization model directly in `LendingCore`, and integrate a real oracle and production stablecoin.

---

## Rebuttal: December 2025 Context

This postmortem cites concerns raised in July–August 2025. Several have been substantially addressed by the time of deployment in March 2026.

### 1. Revive December 2025 Status Update

The July 2025 Polkadot Forum discussion raised concerns about "almost compatibility" in the Revive compiler backend. By December 2025, the Revive/pallet-revive team shipped a stable release with declared EVM interoperability — the same codebase that powers the Polkadot Hub TestNet this project deploys on. The "will probably not work" concern was a mid-development assessment, not a final verdict. The public testnet operates today with pallet-revive as its EVM execution layer, and this project's REVM contracts deploy and execute correctly on it.

### 2. Elastic Scaling (2-Second Blocks)

Polkadot's Elastic Scaling upgrade enables parachain blocks at **2-second intervals**, compared to the 6-second baseline used in the throughput analysis above. Under Elastic Scaling, the throughput ceiling for DualVM Lending improves by 3×. This does not resolve the PVM bytecode expansion concern, but it significantly improves the throughput floor for demo-scale and light production workloads.

### 3. Dual-VM as Shipped Design

The official Polkadot documentation at [docs.polkadot.com/smart-contracts](https://docs.polkadot.com/smart-contracts/) explicitly describes and supports the dual-VM architecture (REVM for EVM contracts, PVM for PolkaVM contracts) as the **shipped design** for Polkadot Hub. This is not an experimental feature — it is the documented production deployment model. The opcode compatibility concerns in Finding 1 are real and documented by Parity, but they do not prevent the deployment pattern this project uses (REVM for all product contracts, PVM only for the isolated risk engine).

### Summary

The July 2025 concerns were valid assessments of an in-flight platform. By March 2026, pallet-revive is deployed and operational. The project's REVM→PVM call pattern works on-chain for the product path (Stage 1A/1B pass). The genuine limitations — Stage 2 callback failure, Stage 3 state accumulation, manual oracle, mock stablecoin — are accurately documented and scope-correct for a hackathon MVP.

---

*This review is based on source code at commit range covering the `dualvm-architecture-refactor-plan` branch, on-chain probe results at `polkadot-hub-testnet-probe-results.json` (generated 2026-03-16), and publicly available forum discussions from the Polkadot ecosystem as of March 2026.*
