#!/usr/bin/env bash
# run-bilateral-proof.sh
#
# Orchestrates the full M11 bilateral async proof on Polkadot Hub TestNet.
# Handles the 3-stage governance flow with appropriate waits between stages.
#
# Usage:
#   cd dualvm
#   bash scripts/run-bilateral-proof.sh
#
# Or to skip to a specific stage (if prior stages were already run):
#   BILATERAL_STAGE=2 bash scripts/run-bilateral-proof.sh
#   BILATERAL_STAGE=3 bash scripts/run-bilateral-proof.sh
#
# Required env vars (or set in .env):
#   PRIVATE_KEY         - deployer private key (must hold governance tokens)
#   POLKADOT_HUB_TESTNET_RPC_URL - primary RPC (default: https://eth-rpc-testnet.polkadot.io/)
#
# Output:
#   deployments/bilateral-proof-state.json     - Stage 1 state (proposalId)
#   deployments/bilateral-proof-artifacts.json - Stage 3 proof artifacts
#   deployments/bilateral-correlator-output.json - Event correlator unified trace

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Configuration ──────────────────────────────────────────────────────────
RPC_URL="${POLKADOT_HUB_TESTNET_RPC_URL:-https://eth-rpc-testnet.polkadot.io/}"
PRIVATE_KEY="${PRIVATE_KEY:-}"
START_STAGE="${BILATERAL_STAGE:-1}"

VOTING_PERIOD_SECONDS=300
TIMELOCK_DELAY_SECONDS=60
WAIT_BUFFER_SECONDS=15  # Extra buffer for confirmation propagation

# Forge script flags required for Polkadot Hub TestNet
FORGE_FLAGS="--legacy --gas-estimate-multiplier 500 --slow --broadcast"

# ── Helpers ─────────────────────────────────────────────────────────────────
log() { echo "[$(date -u +%H:%M:%S)] $*"; }
err() { echo "[$(date -u +%H:%M:%S)] ERROR: $*" >&2; }

wait_with_progress() {
    local seconds=$1
    local msg=$2
    log "Waiting $seconds seconds: $msg"
    local end=$((SECONDS + seconds))
    while [ $SECONDS -lt $end ]; do
        local remaining=$((end - SECONDS))
        printf "\r  [%3ds remaining]" "$remaining"
        sleep 5
    done
    printf "\r  [done]            \n"
}

run_forge_stage() {
    local stage=$1
    log "Running BilateralProof Stage $stage..."
    BILATERAL_STAGE="$stage" forge script script/BilateralProof.s.sol \
        --rpc-url "$RPC_URL" \
        --private-key "$PRIVATE_KEY" \
        $FORGE_FLAGS \
        -vv
    log "Stage $stage complete."
}

# ── Pre-flight checks ──────────────────────────────────────────────────────
if [ -z "$PRIVATE_KEY" ]; then
    # Try loading from .env
    if [ -f "$ROOT_DIR/.env" ]; then
        # shellcheck disable=SC1090
        source <(grep -E '^PRIVATE_KEY=' "$ROOT_DIR/.env" | head -1)
    fi
fi

if [ -z "$PRIVATE_KEY" ]; then
    err "PRIVATE_KEY not set. Set it in .env or export it before running."
    exit 1
fi

cd "$ROOT_DIR"

log "=== DualVM Lending — M11 Bilateral Async Proof ==="
log "RPC: $RPC_URL"
log "Starting at Stage: $START_STAGE"
log ""

# ── Stage 1: Deposit + Governance Proposal + Vote ──────────────────────────
if [ "$START_STAGE" -le 1 ]; then
    log "--- Stage 1: Deposit collateral + Governance Proposal + Vote ---"
    log "This stage:"
    log "  - Delegates voting power to deployer"
    log "  - Deposits WPAS collateral via LendingRouter"
    log "  - Creates governance proposal to grant MINTER+RISK_ADMIN+RELAY_CALLER"
    log "  - Casts vote FOR the proposal"
    log ""
    run_forge_stage 1

    if [ ! -f "deployments/bilateral-proof-state.json" ]; then
        err "Stage 1 failed to create state file. Check forge output above."
        exit 1
    fi

    log ""
    log "Stage 1 complete! Governance proposal created and voted on."
    log "Waiting for voting period to end (${VOTING_PERIOD_SECONDS}s + ${WAIT_BUFFER_SECONDS}s buffer)..."
    wait_with_progress $((VOTING_PERIOD_SECONDS + WAIT_BUFFER_SECONDS)) "Voting period"
fi

# ── Stage 2: Queue the Governance Proposal ────────────────────────────────
if [ "$START_STAGE" -le 2 ]; then
    log ""
    log "--- Stage 2: Queue Governance Proposal to TimelockController ---"
    run_forge_stage 2

    log ""
    log "Stage 2 complete! Proposal queued."
    log "Waiting for timelock delay (${TIMELOCK_DELAY_SECONDS}s + ${WAIT_BUFFER_SECONDS}s buffer)..."
    wait_with_progress $((TIMELOCK_DELAY_SECONDS + WAIT_BUFFER_SECONDS)) "Timelock delay"
fi

# ── Stage 3: Execute + Full Bilateral Proof ────────────────────────────────
if [ "$START_STAGE" -le 3 ]; then
    log ""
    log "--- Stage 3: Execute Governance + Full Bilateral Proof ---"
    log "This stage:"
    log "  - Executes governance proposal (grants MINTER+RISK_ADMIN+RELAY_CALLER)"
    log "  - Mints USDC and seeds pool liquidity"
    log "  - Borrows with correlationId in Borrowed event"
    log "  - Sets GovernancePolicyStore policy via authorized caller"
    log "  - Sets oracle price to make position liquidatable"
    log "  - Liquidates — Liquidated event with correlationId, XCM fires"
    log "  - XcmInbox.receiveReceipt + duplicate revert"
    log "  - Verifies AccessManager governs all contracts"
    log ""
    run_forge_stage 3

    if [ ! -f "deployments/bilateral-proof-artifacts.json" ]; then
        err "Stage 3 failed to create artifacts file. Check forge output above."
        exit 1
    fi
fi

# ── Event Correlator ───────────────────────────────────────────────────────
log ""
log "=== Running Event Correlator ==="
log "Querying historical events to verify bilateral correlationId matching..."

# Extract block range from state and artifacts
FROM_BLOCK="${FROM_BLOCK:-0}"
TO_BLOCK="latest"

ARTIFACTS_OUTPUT="deployments/bilateral-correlator-output.json" \
FROM_BLOCK="$FROM_BLOCK" \
TO_BLOCK="$TO_BLOCK" \
    npx ts-node scripts/event-correlator.ts --historical \
    2>"deployments/bilateral-correlator-stderr.json" \
    | tee "deployments/bilateral-correlator-stdout.jsonl" || true

# Check if correlator found any events
if [ -f "deployments/bilateral-correlator-stdout.jsonl" ] && \
   [ -s "deployments/bilateral-correlator-stdout.jsonl" ]; then
    CORRELATED_COUNT=$(wc -l < "deployments/bilateral-correlator-stdout.jsonl")
    log "Event correlator found $CORRELATED_COUNT correlated pair(s)"
else
    log "Event correlator: no correlated pairs found in the queried range"
    log "Note: Use FROM_BLOCK=<deployment_block> to narrow the search range"
fi

# ── Summary ────────────────────────────────────────────────────────────────
log ""
log "=== Bilateral Proof Complete ==="
log ""
log "Proof artifacts:"
log "  deployments/bilateral-proof-state.json     — Governance proposal state"
log "  deployments/bilateral-proof-artifacts.json — Full proof results"
log "  deployments/bilateral-correlator-output.json — Event correlator JSON"
log "  deployments/bilateral-correlator-stdout.jsonl — Raw correlator output"
log ""

if [ -f "deployments/bilateral-proof-artifacts.json" ]; then
    log "Proof summary:"
    cat deployments/bilateral-proof-artifacts.json
fi

log ""
log "Explorer:"
log "  https://blockscout-testnet.polkadot.io/"
log ""
log "To verify contracts:"
log "  cat deployments/bilateral-proof-artifacts.json | python3 -m json.tool"
