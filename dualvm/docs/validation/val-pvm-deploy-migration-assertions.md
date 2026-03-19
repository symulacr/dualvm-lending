# Validation Assertions: PVM Interop, Deployment & Migration

Generated: 2026-03-16

---

## PVM / Probe Assertions

### VAL-PVM-001 — PVM echo returns exact bytes32

**Behavioral description:** When `RevmQuoteCallerProbe.runEcho(x)` is called with an arbitrary `bytes32` value `x`, the REVM caller cross-VM invokes `PvmQuoteProbe.echo(x)` via the DirectSync transport and stores the result. The stored `lastEchoOutput` must be bitwise identical to `lastEchoInput`.

**Pass condition:** `lastEchoInput == lastEchoOutput == x` after the transaction succeeds.

**Fail condition:** Transaction reverts, or `lastEchoOutput != x`.

**Evidence requirements:**
- Transaction hash on Polkadot Hub TestNet Blockscout.
- On-chain readback of `RevmQuoteCallerProbe.lastEchoInput()` and `RevmQuoteCallerProbe.lastEchoOutput()`.
- `ProbeEchoed` event log with matching `inputValue` and `outputValue` indexed fields.
- Probe results JSON stage `stage1Echo.status == "passed"`.

---

### VAL-PVM-002 — PVM quote returns deterministic risk output

**Behavioral description:** When `RevmQuoteCallerProbe.runQuote(input)` is called with a canonical `QuoteInput` (e.g. utilizationBps=5000, collateralRatioBps=20000, oracleAgeSeconds=60, oracleFresh=true), the PVM-compiled `PvmQuoteProbe.quote()` returns the same deterministic `QuoteOutput` that `DualVmProbeLib.quote()` would produce. The REVM caller stores `lastInputHash`, `lastResultHash`, `lastBorrowRateBps`, `lastMaxLtvBps`, and `lastLiquidationThresholdBps`.

**Pass condition:**
- `lastInputHash == keccak256(abi.encode(5000, 20000, 60, true))`.
- `lastResultHash == keccak256(abi.encode(700, 7500, 8500))`.
- `lastBorrowRateBps == 700`, `lastMaxLtvBps == 7500`, `lastLiquidationThresholdBps == 8500`.

**Fail condition:** Any stored hash or parameter diverges from the deterministic expectation, or the transaction reverts.

**Evidence requirements:**
- Transaction hash on Blockscout.
- On-chain readback of all five stored fields.
- `ProbeQuoted` event log with matching indexed hashes.
- Probe results JSON stage `stage1Quote.status == "passed"`.
- Confirmation that `callCount` incremented by 1.

---

### VAL-PVM-003 — PVM callback changes REVM receiver state

**Behavioral description:** When `PvmCallbackProbe.callbackFingerprint(receiver, callId)` is called, the PVM contract computes `DualVmProbeLib.callbackFingerprint(receiver, callId)` and invokes `IRevmCallbackReceiver.receivePvmResult()` on the REVM `RevmCallbackReceiver` contract. The receiver stores the `callId`, `resultHash`, and scalar values `a=1`, `b=2`.

**Pass condition:**
- `RevmCallbackReceiver.lastCallId() == callId`.
- `RevmCallbackReceiver.lastResultHash() == keccak256(abi.encode(CALLBACK_FINGERPRINT_NAMESPACE, receiver, callId))`.
- `RevmCallbackReceiver.lastA() == 1` and `RevmCallbackReceiver.lastB() == 2`.

**Fail condition:** Transaction reverts, or any stored field does not match.

**Evidence requirements:**
- Transaction hash on Blockscout.
- On-chain readback of `lastCallId`, `lastResultHash`, `lastA`, `lastB` from `RevmCallbackReceiver`.
- Probe results JSON `stage2.subresults.callbackFingerprint.status == "passed"`.

---

### VAL-PVM-004 — Roundtrip settlement stores PVM-derived state

**Behavioral description:** When `RevmRoundTripSettlementProbe.settleBorrow(input, debtDelta)` is called, the REVM settlement probe calls the quote adapter, which cross-VM invokes the PVM quote probe, then stores the resulting `principalDebt`, `lastBorrowRateBps`, `lastMaxLtvBps`, `lastLiquidationThresholdBps`, `lastQuoteHash`, and increments `settlementCount`. For `debtDelta=1000` with `borrowRateBps=700`, the applied debt is `1000 + (1000 * 700 / 10000) = 1070`.

**Pass condition:**
- `principalDebt == 1070`.
- `lastBorrowRateBps == 700`, `lastMaxLtvBps == 7500`, `lastLiquidationThresholdBps == 8500`.
- `lastQuoteHash == keccak256(abi.encode(700, 7500, 8500))`.
- `settlementCount >= 1`.
- `RoundTripSettled` event emitted with `action == keccak256("BORROW")`.

**Fail condition:** Any stored value diverges or transaction reverts.

**Evidence requirements:**
- Transaction hash on Blockscout.
- On-chain readback of all six stored fields.
- `RoundTripSettled` event log.
- Probe results JSON `stage3.subresults.settleBorrow.status == "passed"`.

---

### VAL-PVM-005 — All probe verdicts A=true, B=true, C=true, D=false

**Behavioral description:** After executing all four probe stages (echo, quote, callback, roundtrip), the `collect-proof` script computes verdict flags. A (direct compute) = stage1Echo passed AND stage1Quote passed. B (roundtrip) = stage3 passed. C (callback) = stage2 passed. D (not defensible) = none of A/B/C are true.

**Pass condition:** `verdicts.A == true`, `verdicts.B == true`, `verdicts.C == true`, `verdicts.D == false`.

**Fail condition:** Any verdict diverges from expected.

**Evidence requirements:**
- Probe results JSON at `deployments/polkadot-hub-testnet-probe-results.json` containing `verdicts` object.
- `finalSummary` string contains "Outcome B proven".
- All four stage statuses are `"passed"` in the results JSON.

---

### VAL-PVM-006 — PVM probe fingerprint matches expected constant

**Behavioral description:** Calling `PvmQuoteProbe.fingerprint()` returns `DualVmProbeLib.PVM_FINGERPRINT` which is `keccak256("DUALVM_PVM_QUOTE_PROBE_V1")`. This confirms the deployed PVM bytecode contains the correct library identity.

**Pass condition:** `PvmQuoteProbe.fingerprint() == keccak256("DUALVM_PVM_QUOTE_PROBE_V1")`.

**Fail condition:** Return value differs or call reverts.

**Evidence requirements:**
- Static call result from the deployed PVM probe address.
- Matching constant from `DualVmProbeLib.sol` source.

---

### VAL-PVM-007 — PVM callback quote propagates risk parameters through REVM receiver

**Behavioral description:** When `PvmCallbackProbe.callbackQuote(receiver, callId, input)` is called with the canonical QuoteInput, the PVM contract computes the full quote and calls `receivePvmResult()` with the quote hash and `a=borrowRateBps`, `b=maxLtvBps`. The REVM receiver stores these values.

**Pass condition:**
- `RevmCallbackReceiver.lastA() == 700` (borrowRateBps).
- `RevmCallbackReceiver.lastB() == 7500` (maxLtvBps).
- `RevmCallbackReceiver.lastResultHash()` matches the deterministic quote output hash.

**Fail condition:** Any value diverges or transaction reverts.

**Evidence requirements:**
- Transaction hash on Blockscout.
- On-chain readback from `RevmCallbackReceiver`.
- Probe results JSON `stage2.subresults.callbackQuote.status == "passed"`.

---

### VAL-PVM-008 — Roundtrip liquidation-check stores quote state without debt mutation

**Behavioral description:** When `RevmRoundTripSettlementProbe.settleLiquidationCheck(input)` is called, the settlement probe queries the PVM quote via the adapter and records risk parameters without changing `principalDebt`. The `settlementCount` increments.

**Pass condition:**
- `principalDebt` unchanged from prior value.
- `lastBorrowRateBps`, `lastMaxLtvBps`, `lastLiquidationThresholdBps` reflect the PVM-derived quote.
- `settlementCount` incremented by 1.
- `RoundTripSettled` event emitted with `action == keccak256("LIQUIDATION_CHECK")`.

**Fail condition:** `principalDebt` changes, or risk parameters diverge, or event not emitted.

**Evidence requirements:**
- Transaction hash on Blockscout.
- On-chain readback pre and post call.
- Probe results JSON `stage3.subresults.settleLiquidationCheck.status == "passed"`.

---

## Deployment / Verification Assertions

### VAL-DEPLOY-001 — All contracts explorer-verified on Blockscout

**Behavioral description:** Every contract in the deployment manifest has a corresponding Blockscout address page with verified source code accessible at the `#code` tab. Verification means the Blockscout page displays the Solidity source, compiler version, and ABI.

**Pass condition:** For each contract in the manifest (`accessManager`, `wpas`, `usdc`, `oracle`, `riskEngine`, `debtPool`, `lendingCore`, `marketRegistry`, `governanceMultisig`, `governanceTimelock`), the Blockscout `address/{addr}#code` page shows verified source.

**Fail condition:** Any contract address returns "not verified" or does not exist on Blockscout.

**Evidence requirements:**
- `deployments/polkadot-hub-testnet-verification.json` containing explorer URLs for each contract.
- Screenshot or HTTP 200 response from each Blockscout `#code` URL.
- Chain ID matches `420420417`.

---

### VAL-DEPLOY-002 — Consolidated manifest matches deployed addresses

**Behavioral description:** The deployment manifest JSON files (`polkadot-hub-testnet.json`, `polkadot-hub-testnet-governed.json`, `polkadot-hub-testnet-versioned.json`) contain contract addresses. For each address, `eth_getCode` at that address on the live RPC returns non-empty bytecode.

**Pass condition:** Every address in `contracts` and `governance` sections of the manifest returns `eth_getCode != "0x"` on the Polkadot Hub TestNet RPC.

**Fail condition:** Any listed address returns empty bytecode.

**Evidence requirements:**
- RPC `eth_getCode` responses for all manifest addresses.
- Manifest JSON files with `generatedAt` timestamps.
- Cross-reference of addresses between manifest files for shared contracts (e.g. `quoteEngine` address `0x9a78F65b00E0AeD0830063eD0ea66a0B5d8876DE` appears in probe, versioned, and governed manifests).

---

### VAL-DEPLOY-003 — Governor (TimelockController) is the effective admin root

**Behavioral description:** In the governed deployment, `DualVMAccessManager.hasRole(0, timelockAddress)` returns true (the Timelock holds the ADMIN role), and `DualVMAccessManager.hasRole(0, deployerEOA)` returns false (the deployer's admin role was revoked). The governance chain is: Multisig → TimelockController → AccessManager → all managed contracts.

**Pass condition:**
- `accessManager.hasRole(0, governanceTimelock) == (true, ...)`.
- `accessManager.hasRole(0, deployerEOA) == (false, ...)`.
- Governed manifest `governance.admin` matches the timelock address.

**Fail condition:** Any single EOA holds the ADMIN (role 0) on the governed AccessManager, or the timelock does not hold it.

**Evidence requirements:**
- `deployments/polkadot-hub-testnet-governed.json` showing `governance.admin` == timelock address `0x6b7D4ea43CB286aF7367a7e1671de2530b10B630`.
- `deployments/polkadot-hub-testnet-governed-results.json` showing the revoke deployer admin transaction.
- On-chain `hasRole` readback for both timelock and deployer addresses.

---

### VAL-DEPLOY-004 — Role delays are non-zero for sensitive operations

**Behavioral description:** In the governed deployment, the `RISK_ADMIN`, `TREASURY`, and `MINTER` roles have non-zero execution delays configured via `grantRole(roleId, account, executionDelay)`. Additionally, `setTargetAdminDelay` is applied to all managed contracts with a non-zero admin delay.

**Pass condition:**
- `governance.executionDelaySeconds.riskAdmin >= 5`.
- `governance.executionDelaySeconds.treasury >= 5`.
- `governance.executionDelaySeconds.minter >= 5`.
- `config.adminDelaySeconds >= 5`.
- A scheduled-then-executed proof transaction exists for at least one role-gated function.

**Fail condition:** Any sensitive role has a zero execution delay in the governed deployment, or admin delay is zero.

**Evidence requirements:**
- `deployments/polkadot-hub-testnet-governed.json` `governance.executionDelaySeconds` section.
- `deployments/polkadot-hub-testnet-governance-proof.json` showing schedule+execute transaction pairs (e.g. `riskAdminSmoke.setTemporaryRiskEngineSchedule` / `setTemporaryRiskEngineExecute`).
- On-chain `AccessManager.getRoleGrantDelay` and `AccessManager.getTargetAdminDelay` readbacks.

---

### VAL-DEPLOY-005 — Probe deployment manifest records all five probe contracts

**Behavioral description:** The probe deployment manifest at `deployments/polkadot-hub-testnet-probes.json` records the addresses, deploy transaction hashes, and explorer URLs for all five probe contracts: `PvmQuoteProbe`, `PvmCallbackProbe`, `RevmCallbackReceiver`, `RevmQuoteCallerProbe`, `RevmRoundTripSettlementProbe`.

**Pass condition:** All five entries exist with non-null `address`, `deployTxHash`, and `explorerUrl` fields. Stage 0 status is `"passed"`.

**Fail condition:** Any probe entry is missing, or any field is null/empty.

**Evidence requirements:**
- `deployments/polkadot-hub-testnet-probes.json` content.
- `deployments/polkadot-hub-testnet-probe-results.json` `stages.stage0.status == "passed"`.

---

### VAL-DEPLOY-006 — PVM probe contracts have recorded code hashes

**Behavioral description:** Both PVM probe contracts (`PvmQuoteProbe`, `PvmCallbackProbe`) have `codeHash` fields in the probe deployment manifest, obtained via `revive.accountInfoOf` or equivalent on-chain introspection. These hashes prove the PVM bytecode was deployed through the Polkadot revive/resolc compilation path.

**Pass condition:**
- `pvm.quoteProbe.codeHash` is a non-null 32-byte hex string.
- `pvm.callbackProbe.codeHash` is a non-null 32-byte hex string.
- The `pvmTargetId` stored in `RevmQuoteCallerProbe` matches `pvm.quoteProbe.codeHash`.

**Fail condition:** Any codeHash is missing/null, or the pvmTargetId does not match.

**Evidence requirements:**
- `deployments/polkadot-hub-testnet-probes.json` `pvm.quoteProbe.codeHash` and `pvm.callbackProbe.codeHash`.
- On-chain readback of `RevmQuoteCallerProbe.pvmTargetId()` matching `0xba8fe2a621062a30bba558a3846d0a18bfb2e9a09bfaed656b123e698b59af5b`.

---

### VAL-DEPLOY-007 — Multisig governance root has threshold > 1

**Behavioral description:** The `DualVMMultisig` contract deployed as the governance root has at least 2 owners and a confirmation threshold > 1, preventing single-key governance actions.

**Pass condition:**
- `governanceRoot.multisig.owners.length >= 2`.
- `governanceRoot.multisig.threshold >= 2`.
- Timelock proposer role is limited to the multisig address.

**Fail condition:** Threshold is 1, or only one owner is registered.

**Evidence requirements:**
- `deployments/polkadot-hub-testnet-governed-results.json` `governanceRoot.multisig` section showing `owners` array and `threshold`.
- On-chain readback of multisig owners and threshold.

---

### VAL-DEPLOY-008 — Timelock has non-zero minimum delay

**Behavioral description:** The `DualVMTimelockController` is deployed with a `minDelay > 0`, ensuring that all governance-gated operations require a waiting period between scheduling and execution.

**Pass condition:** `governanceRoot.timelock.minDelaySeconds > 0`.

**Fail condition:** `minDelaySeconds == 0`.

**Evidence requirements:**
- `deployments/polkadot-hub-testnet-governed-results.json` `governanceRoot.timelock.minDelaySeconds == 60`.
- On-chain readback of `TimelockController.getMinDelay()`.

---

## Migration Assertions

### VAL-MIG-001 — MarketVersionRegistry version registration succeeds through governance

**Behavioral description:** A new market version can be registered via `MarketVersionRegistry.registerVersion()` when called by an account with the appropriate role (GOVERNANCE or RISK_ADMIN depending on deployment). The registry validates that `lendingCore.debtPool() == debtPool`, `lendingCore.oracle() == oracle`, `lendingCore.riskEngine() == riskEngine`, and `debtPool.lendingCore() == lendingCore` before storing the version.

**Pass condition:**
- `registerVersion` transaction succeeds.
- `latestVersionId` increments by 1.
- `MarketVersionRegistered` event is emitted with matching addresses and configHash.
- `getVersion(newVersionId)` returns all expected addresses.

**Fail condition:** Transaction reverts, or stored version metadata does not match inputs.

**Evidence requirements:**
- Transaction hash on Blockscout (e.g. from `polkadot-hub-testnet-versioned-results.json` `smokeProof.versionActivationFlow.registerTx`).
- On-chain readback of `getVersion()`.

---

### VAL-MIG-002 — MarketVersionRegistry version activation works through governance

**Behavioral description:** `MarketVersionRegistry.activateVersion(versionId)` transitions the active version. Only registered versions can be activated. Activating the already-active version reverts with `VersionAlreadyActive`.

**Pass condition:**
- `activateVersion(newId)` succeeds and `activeVersionId == newId`.
- `MarketVersionActivated` event emitted with correct `previousVersionId` and new `versionId`.
- Calling `activateVersion(newId)` again reverts with `VersionAlreadyActive`.

**Fail condition:** Activation of an unregistered version succeeds, or activating the already-active version does not revert.

**Evidence requirements:**
- Transaction hash on Blockscout (e.g. `smokeProof.versionActivationFlow.activateTx`).
- On-chain readback of `activeVersionId()` and `activeVersion()`.

---

### VAL-MIG-003 — Live migration: borrower position exported from v1

**Behavioral description:** `IMigratableLendingCore.exportPositionForMigration(borrower)` on the v1 LendingCore returns a `MigratedPosition` struct containing the borrower's `collateralAmount`, `principalDebt`, and `accruedInterest`, and zeroes out the position in v1.

**Pass condition:**
- Returned `MigratedPosition.collateralAmount > 0` if borrower had collateral.
- Returned `MigratedPosition.principalDebt > 0` if borrower had debt.
- After export, `v1.currentDebt(borrower) == 0` and collateral balance is zero.

**Fail condition:** Export returns zero when borrower had an active position, or v1 position is not zeroed after export.

**Evidence requirements:**
- Transaction hash of `MarketMigrationCoordinator.migrateBorrower()` on Blockscout.
- Pre-export readback of borrower position on v1.
- Post-export readback confirming zeroed v1 position.
- `BorrowerMigrated` event emitted.

---

### VAL-MIG-004 — Live migration: borrower position imported to v2

**Behavioral description:** `IMigratableLendingCore.importMigratedPosition(borrower, position)` on the v2 LendingCore accepts the exported position and reconstitutes the borrower's collateral and debt in the new market version.

**Pass condition:**
- After import, `v2.currentDebt(borrower)` approximately equals the exported `principalDebt + accruedInterest`.
- Borrower's collateral balance on v2 equals the exported `collateralAmount`.
- `BorrowerMigrated` event is emitted by `MarketMigrationCoordinator`.

**Fail condition:** Imported position has zero debt/collateral when export was non-zero, or values differ beyond rounding tolerance.

**Evidence requirements:**
- Transaction hash on Blockscout.
- Post-import readback of borrower position on v2.
- Cross-reference exported amounts vs imported amounts.

---

### VAL-MIG-005 — Migration route must be opened before borrower migration

**Behavioral description:** `MarketMigrationCoordinator.migrateBorrower(fromId, toId)` reverts with `MigrationRouteClosed` if `openMigrationRoute(fromId, toId, true, _)` has not been called first.

**Pass condition:** Calling `migrateBorrower` without an open route reverts with `MigrationRouteClosed(fromId, toId)`.

**Fail condition:** Migration succeeds without an open route.

**Evidence requirements:**
- Revert transaction or local test showing the revert reason.
- Subsequent success after `openMigrationRoute` is called.

---

### VAL-MIG-006 — Migration target must be the active version

**Behavioral description:** `MarketMigrationCoordinator.migrateBorrower(fromId, toId)` reverts with `InvalidMigrationRoute` if `marketRegistry.activeVersionId() != toId`, preventing migration to a non-active market version.

**Pass condition:** Migration to a non-active version reverts with `InvalidMigrationRoute`.

**Fail condition:** Migration to a non-active version succeeds.

**Evidence requirements:**
- Revert transaction or local test showing the revert reason.

---

### VAL-MIG-007 — Migration validates asset pair compatibility

**Behavioral description:** `MarketMigrationCoordinator._validateAssetPair()` ensures that `fromVersion.collateralAsset == toVersion.collateralAsset` and `fromVersion.debtAsset == toVersion.debtAsset`. Mismatched asset pairs revert with `UnsupportedAssetPair`.

**Pass condition:** Migration between versions with different collateral or debt assets reverts with `UnsupportedAssetPair`.

**Fail condition:** Migration succeeds with mismatched assets.

**Evidence requirements:**
- Local test or on-chain revert showing the error.

---

## XCM Precompile Assertions

### VAL-XCM-001 — XCM precompile weighMessage call succeeds from contract

**Behavioral description:** A Solidity contract deployed on the Polkadot Hub TestNet can call the XCM precompile's `weighMessage(encodedMessage)` function and receive a weight estimation without revert. This demonstrates that the XCM precompile is accessible from EVM contracts on the testnet.

**Pass condition:** The call to the XCM precompile at the known precompile address returns a non-zero weight value without revert.

**Fail condition:** The call reverts, returns zero, or the precompile is not accessible.

**Evidence requirements:**
- Transaction hash or static call result on Blockscout.
- The XCM precompile address used and the encoded message payload.
- Note: As of the current codebase, no `CrossChainQuoteEstimator` contract exists. XCM is documented as "out of the MVP critical path." This assertion is aspirational and requires a new contract to be deployed.

---

## Product-Path Assertions

### VAL-PVM-009 — Product-path quote engine is a PVM-compiled contract (code hash verified)

**Behavioral description:** In the governed and versioned deployments, the `quoteEngine` address in the manifest is the same as the PVM-deployed `PvmQuoteProbe` address. The `RiskAdapter.quoteEngine()` on-chain returns this address. The code hash of this address (obtained via `revive.accountInfoOf` or the probe deployment manifest) confirms it was compiled through the resolc/PVM path.

**Pass condition:**
- `RiskAdapter.quoteEngine()` returns `0x9a78F65b00E0AeD0830063eD0ea66a0B5d8876DE`.
- This address matches `deployments/polkadot-hub-testnet-probes.json` `pvm.quoteProbe.address`.
- The `codeHash` for this address (`0xba8fe2a621062a30bba558a3846d0a18bfb2e9a09bfaed656b123e698b59af5b`) is non-null and recorded in the probe manifest.
- The governed, versioned, and quote-ticket manifests all reference the same `quoteEngine` address.

**Fail condition:** The `quoteEngine` address differs between manifests, or it does not match the PVM probe deployment, or the code hash is missing.

**Evidence requirements:**
- On-chain readback of `RiskAdapter.quoteEngine()` from the governed deployment (`riskEngine` at `0xc0667015c860552886c413179A23BB1031F081bA`).
- Cross-manifest comparison of `quoteEngine` address across `polkadot-hub-testnet-governed.json`, `polkadot-hub-testnet-versioned.json`, `polkadot-hub-testnet-quote-ticket.json`, and `polkadot-hub-testnet-probes.json`.
- `pvm.quoteProbe.codeHash` from the probe manifest.

---

### VAL-PVM-010 — RevmQuoteCallerProbe transport mode is DirectSync

**Behavioral description:** The `RevmQuoteCallerProbe` and `RevmRoundTripSettlementProbe` are configured with `TransportMode.DirectSync`, confirming that the cross-VM invocation is a synchronous in-process call rather than an async or off-chain relay.

**Pass condition:**
- `RevmQuoteCallerProbe.transportMode() == TransportMode.DirectSync (1)`.
- Probe deployment manifest `revm.quoteCaller.transportMode == "DirectSync"`.

**Fail condition:** Transport mode is `Unknown`, `AsyncOnchain`, or `OffchainRelay`.

**Evidence requirements:**
- On-chain readback of `transportMode()`.
- Probe deployment manifest field.
- Event logs from probe runs showing `transportMode` parameter.
