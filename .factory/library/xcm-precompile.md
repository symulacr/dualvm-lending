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

## V5 send/execute notes
- The milestone-6 send/execute flows use XCM V5 encodings (`0x05` version prefix), not the older `0x01...` destination examples.
- Relay-chain parent destination should be encoded as `0x050100` (VersionedLocation V5, parents=1, Here).
- `execute()` payloads that include `WithdrawAsset`/`BuyExecution` require the calling contract to hold native PAS for fees; unfunded contracts can revert even when the wire format is correct.
- The milestone-6 deployment artifact `dualvm/deployments/polkadot-hub-testnet-xcm-full-integration.json` currently proves `ClearOrigin`-style calls succeeded, but scrutiny flagged that the required Polkadot docs sample payload still needs an explicit live attempt.
