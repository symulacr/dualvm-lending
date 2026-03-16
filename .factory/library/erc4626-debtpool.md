## DebtPool ERC-4626 inflation note

- `dualvm/contracts/DebtPool.sol` inherits OpenZeppelin `ERC4626` and does **not** override `_decimalsOffset()`, so it uses the default virtual offset behavior with `_decimalsOffset() == 0`.
- That default still makes the classic deposit-then-donate inflation attack net-unprofitable for the attacker, but it only provides minimal rounding protection.
- A large direct donation can still materially dilute a later depositor's redeemability even though the attacker cannot profit overall.
- If production-grade inflation resistance becomes a goal, consider a non-zero `_decimalsOffset()` override (for example `6`) and re-check downstream share/accounting assumptions.
