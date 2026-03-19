#!/usr/bin/env bash
# =============================================================================
# script/DeployPVM.sh
#
# Compiles DeterministicRiskModel.sol for PolkaVM (PVM) via resolc and deploys
# the resulting bytecode to the target chain using `cast publish` or `forge create`.
#
# Prerequisites:
#   - resolc must be available in PATH or at RESOLC_BIN (see below)
#   - PRIVATE_KEY env var must be set with the deployer private key
#   - RPC_URL env var must be set with the target chain RPC endpoint
#
# Usage:
#   chmod +x script/DeployPVM.sh
#   PRIVATE_KEY=0x... RPC_URL=https://eth-rpc-testnet.polkadot.io/ ./script/DeployPVM.sh
#
# Output:
#   Prints the deployed PVM contract address and writes it to
#   deployments/pvm-risk-model-address.txt for use by the canonical deployment.
#
# Notes:
#   - The PVM DeterministicRiskModel cannot be verified on Blockscout via
#     standard Solidity verification (compiled via resolc for PolkaVM).
#   - Confirm the PVM code hash via `revive.accountInfoOf(address)` on the
#     Substrate API (WSS endpoint wss://asset-hub-paseo-rpc.n.dwellir.com).
#   - On local anvil, PVM deployment is not meaningful — this script targets
#     Polkadot Hub TestNet (chain ID 420420417) exclusively.
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DUALVM_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RESOLC_BIN="${RESOLC_BIN:-resolc}"
CONTRACT_SRC="$DUALVM_ROOT/contracts/pvm/DeterministicRiskModel.sol"
PVM_OUT_DIR="$DUALVM_ROOT/pvm-artifacts"
PVM_ABI_OUT="$PVM_OUT_DIR/DeterministicRiskModel.abi"
PVM_BIN_OUT="$PVM_OUT_DIR/DeterministicRiskModel.bin"
MANIFEST_ADDR_FILE="$DUALVM_ROOT/deployments/pvm-risk-model-address.txt"

PRIVATE_KEY="${PRIVATE_KEY:-}"
RPC_URL="${RPC_URL:-https://eth-rpc-testnet.polkadot.io/}"

# Risk model constructor arguments (must match Deploy.s.sol constants)
BASE_RATE_BPS=200
SLOPE1_BPS=800
SLOPE2_BPS=3000
KINK_BPS=8000
HEALTHY_MAX_LTV_BPS=7500
STRESSED_MAX_LTV_BPS=6500
HEALTHY_LIQ_THRESHOLD_BPS=8500
STRESSED_LIQ_THRESHOLD_BPS=7800
STALE_PENALTY_BPS=1000
STRESSED_COLLATERAL_RATIO_BPS=14000

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
if [[ -z "$PRIVATE_KEY" ]]; then
  echo "ERROR: PRIVATE_KEY env var is not set." >&2
  echo "       Export your deployer private key: export PRIVATE_KEY=0x..." >&2
  exit 1
fi

if ! command -v "$RESOLC_BIN" &>/dev/null; then
  echo "ERROR: resolc not found at '$RESOLC_BIN'." >&2
  echo "       Install resolc (Polkadot's Solidity-to-PolkaVM compiler):" >&2
  echo "         cargo install resolc" >&2
  echo "       Or set RESOLC_BIN=/path/to/resolc" >&2
  exit 1
fi

if ! command -v cast &>/dev/null; then
  echo "ERROR: cast (foundry) not found. Install foundry: https://getfoundry.sh" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Step 1: Compile DeterministicRiskModel via resolc
# ---------------------------------------------------------------------------
mkdir -p "$PVM_OUT_DIR"

echo "==> Compiling DeterministicRiskModel.sol via resolc..."
echo "    Source:  $CONTRACT_SRC"
echo "    Out dir: $PVM_OUT_DIR"

# resolc outputs contract ABI and PVM bytecode
"$RESOLC_BIN" \
  --abi \
  --bin \
  --output-dir "$PVM_OUT_DIR" \
  --base-path "$DUALVM_ROOT" \
  --include-path "$DUALVM_ROOT/node_modules" \
  --overwrite \
  "$CONTRACT_SRC"

# resolc produces files named after the contract
RESOLC_ABI="$PVM_OUT_DIR/DeterministicRiskModel.abi"
RESOLC_BIN_FILE="$PVM_OUT_DIR/DeterministicRiskModel.bin"

if [[ ! -f "$RESOLC_BIN_FILE" ]]; then
  echo "ERROR: resolc did not produce $RESOLC_BIN_FILE" >&2
  echo "       Check resolc output above for errors." >&2
  exit 1
fi

PVM_BYTECODE=$(cat "$RESOLC_BIN_FILE")
if [[ -z "$PVM_BYTECODE" ]]; then
  echo "ERROR: PVM bytecode is empty." >&2
  exit 1
fi

echo "==> PVM bytecode compiled (${#PVM_BYTECODE} hex chars)"

# ---------------------------------------------------------------------------
# Step 2: ABI-encode constructor arguments
# ---------------------------------------------------------------------------
echo "==> Encoding constructor arguments..."

CONSTRUCTOR_ARGS=$(cast abi-encode \
  "constructor(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)" \
  "$BASE_RATE_BPS" \
  "$SLOPE1_BPS" \
  "$SLOPE2_BPS" \
  "$KINK_BPS" \
  "$HEALTHY_MAX_LTV_BPS" \
  "$STRESSED_MAX_LTV_BPS" \
  "$HEALTHY_LIQ_THRESHOLD_BPS" \
  "$STRESSED_LIQ_THRESHOLD_BPS" \
  "$STALE_PENALTY_BPS" \
  "$STRESSED_COLLATERAL_RATIO_BPS")

# Strip 0x prefix from args and append to bytecode
CONSTRUCTOR_ARGS_HEX="${CONSTRUCTOR_ARGS#0x}"
DEPLOY_BYTECODE="0x${PVM_BYTECODE}${CONSTRUCTOR_ARGS_HEX}"

# ---------------------------------------------------------------------------
# Step 3: Deploy PVM bytecode via cast send
# ---------------------------------------------------------------------------
echo "==> Deploying PVM DeterministicRiskModel to $RPC_URL..."

DEPLOYER_ADDRESS=$(cast wallet address "$PRIVATE_KEY")
echo "    Deployer: $DEPLOYER_ADDRESS"

TX_HASH=$(cast send \
  --rpc-url "$RPC_URL" \
  --private-key "$PRIVATE_KEY" \
  --create "$DEPLOY_BYTECODE" \
  --json \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['transactionHash'])")

echo "==> Transaction sent: $TX_HASH"
echo "==> Waiting for receipt..."

RECEIPT=$(cast receipt \
  --rpc-url "$RPC_URL" \
  "$TX_HASH" \
  --json)

PVM_CONTRACT_ADDRESS=$(echo "$RECEIPT" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['contractAddress'])")

if [[ -z "$PVM_CONTRACT_ADDRESS" || "$PVM_CONTRACT_ADDRESS" == "null" ]]; then
  echo "ERROR: Could not extract contract address from receipt." >&2
  echo "       Receipt: $RECEIPT" >&2
  exit 1
fi

echo "==> PVM DeterministicRiskModel deployed at: $PVM_CONTRACT_ADDRESS"

# ---------------------------------------------------------------------------
# Step 4: Save address to file
# ---------------------------------------------------------------------------
mkdir -p "$(dirname "$MANIFEST_ADDR_FILE")"
echo "$PVM_CONTRACT_ADDRESS" > "$MANIFEST_ADDR_FILE"
echo "==> Address saved to: $MANIFEST_ADDR_FILE"

# ---------------------------------------------------------------------------
# Step 5: Optionally verify PVM code hash via revive.accountInfoOf
# ---------------------------------------------------------------------------
echo ""
echo "==> IMPORTANT: The PVM contract cannot be verified via Blockscout standard"
echo "    Solidity verification (compiled via resolc for PolkaVM)."
echo "    Verify the PVM code hash via the Substrate API:"
echo "    WSS: wss://asset-hub-paseo-rpc.n.dwellir.com"
echo "    Method: api.rpc.revive.accountInfoOf('$PVM_CONTRACT_ADDRESS')"
echo ""
echo "==> Next step: Update RiskGateway to use this PVM address as quoteEngine."
echo "    Since RiskGateway.quoteEngine is immutable, redeploy RiskGateway with:"
echo "    QUOTE_ENGINE_ADDRESS=$PVM_CONTRACT_ADDRESS forge script script/Deploy.s.sol ..."
echo "    (Or modify Deploy.s.sol to accept PVM_QUOTE_ENGINE env var)"
echo ""
echo "Done. PVM DeterministicRiskModel: $PVM_CONTRACT_ADDRESS"
