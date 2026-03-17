# XCM Precompile

Canonical Polkadot Hub XCM precompile details for Track 2 work.

## Address
- `0x00000000000000000000000000000000000A0000`

## Solidity interface surface
- `execute(bytes message, Weight weight)`
- `send(bytes destination, bytes message)`
- `weighMessage(bytes message) returns (Weight weight)`

```solidity
struct Weight {
    uint64 refTime;
    uint64 proofSize;
}
```

## Current reference
- Official docs: `https://docs.polkadot.com/develop/smart-contracts/precompiles/xcm-precompile/`

## Local testing note
- On local Hardhat, the XCM precompile address has no code, so live `weighMessage` calls revert.
- Local tests should verify wrapper compilation, ABI/interface correctness, and explicit handling of the missing precompile.

## Live testnet proof
- Polkadot Hub TestNet live proof now exists at `dualvm/deployments/polkadot-hub-testnet-xcm-proof.json`.
- `CrossChainQuoteEstimator.estimateCrossChainQuoteCost(...)` succeeded on the deployed contract and returned non-zero weight values: `refTime=979880000`, `proofSize=10943`.
- This confirms `weighMessage()` is callable through the canonical XCM precompile on the live REVM route.
