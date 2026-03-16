export const DEFAULT_OBSERVER_ADDRESS = "0x31FA19B35fdBD96f381A0be838799ca40978D080";

export const judgeFlow = [
  "Wrap PAS into WPAS.",
  "LP deposits USDC-test into the debt pool.",
  "Borrower deposits WPAS collateral into LendingCore.",
  "Borrower draws stable debt.",
  "Borrower repays or the oracle moves and health factor falls.",
  "Liquidation closes unsafe debt when required.",
] as const;

export const scopeGuardrails = [
  "One isolated market only.",
  "REVM is the solvency source of truth.",
  "PVM is a bounded parity-oriented computation module.",
  "Oracle reads are freshness-gated and now include a configurable circuit breaker.",
  "No XCM in the MVP critical path.",
  "Public-RPC-first deployment; no local Polkadot node requirement.",
] as const;

export const demoModeNotes = [
  "Observer-first frontend: this page is for live state, proof links, and tracked-address inspection.",
  "No hidden backend, indexer cluster, or local Polkadot node is required for judges.",
  "Public RPC failures are normal on a shared testnet; retry and use the recent-activity proof links when reads stall.",
] as const;

export const writePathTruth = [
  "The browser build does not yet submit borrow or repay transactions directly.",
  "Write-path proof comes from live operator-run transactions plus Blockscout links, not from fake-complete buttons.",
  "The canonical demo sequence lives in docs/dualvm/dualvm_submission_demo_guide.md and the repo README.",
] as const;

export function humanizeReadError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("429") || normalized.includes("rate")) {
    return "Public RPC rate-limited the request. Wait a few seconds and refresh; recent activity falls back to the last captured snapshot.";
  }
  if (normalized.includes("fetch") || normalized.includes("network") || normalized.includes("timeout")) {
    return "Public RPC did not answer cleanly. Refresh to retry; contract addresses and recent-activity proof links remain valid below.";
  }
  return message;
}
