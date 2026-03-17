# DualVM Lending — Deployment Status

**Network**: Polkadot Hub TestNet · Chain ID `420420417`  
**Explorer**: [Blockscout](https://blockscout-testnet.polkadot.io/)  
**Frontend**: [https://dualvm-lending.vercel.app](https://dualvm-lending.vercel.app) (backup: [eyawa.me/dualvm-lending/](http://eyawa.me/dualvm-lending/))  
**Governance Root**: Governor → TimelockController → AccessManager (deployer has no roles)

## Contract Addresses

| Contract | Address |
|----------|---------|
| AccessManager | `0x32d0a9eb8F4Bd54F0610c31c277fD2E62e4ac2f0` |
| WPAS | `0x9b9e0c534E0Bfc938674238aFA44bCD1690F10F1` |
| USDCMock | `0x75d47bd99ECd7188FB63e00cD07035CDBBf7Ef06` |
| ManualOracle | `0x1CCE5059dc39A7cf8f064f6DA6Be9da09279Ee04` |
| RiskAdapter | `0x67D0B226b5aE56A29E206840Ecd389670718Af66` |
| PvmQuoteProbe | `0x9a78F65b00E0AeD0830063eD0ea66a0B5d8876DE` |
| MarketVersionRegistry | `0x47AE8aE7423bD8643Be8a86d4C0Df7fdcC57987d` |
| DebtPool | `0xeEdA5d44810E09D8F881Fca537456E2a5eD437bB` |
| LendingCore | `0x9faC289188229f40aBfaa4F8d720C14b8B448CF9` |
| GovernanceToken | `0x5C0201E6db2D4f1a97efeed09f4620A242116Bd1` |
| DualVMGovernor | `0xa6d2c210f8A11F2D87b08efA8F832B4e64e521b3` |
| TimelockController | `0x65712EEFD810F077c6C11Fd7c18988d3ce569C60` |

## Live Proof Links

- **Borrow**: [0x5a9edd08...](https://blockscout-testnet.polkadot.io/tx/0x5a9edd08efd8aec5e1ccbe0295b97e03cebc1b75588acf19a2738a109deba532)
- **Repay**: [0x02825742...](https://blockscout-testnet.polkadot.io/tx/0x02825742b3d9cdc5e8c27b1ae30948d73885188c2e43a0de5c6105606c441dde)
- **Liquidation**: [0xeec68ce0...](https://blockscout-testnet.polkadot.io/tx/0xeec68ce067523113520a888e9344860ea9d9421c135a6db6823da56ebe12048b)
- **PVM Echo**: [0x282f3253...](https://blockscout-testnet.polkadot.io/tx/0x282f32532f1bc337266e7a0d849edb1153449be7fad9d4b9feacec8aded641d0)
- **PVM Quote**: [0x4f55eac1...](https://blockscout-testnet.polkadot.io/tx/0x4f55eac1f75b6540e3d81d3618a8857574551809fce2b08bfc4e11a4b15b5698)
- **Migration**: [0x6d959dc9...](https://blockscout-testnet.polkadot.io/tx/0x6d959dc9bc4ccf8ba2b815f6ad996ef5026f40e90c5e932542adfccaba45d78f)
- **XCM weighMessage**: [0xc147ac14...](https://blockscout-testnet.polkadot.io/tx/0xc147ac140cc9591bcdd444478ed27d72ce4fd05312d5f8ef16f4e6dfe7439cc0)

## Known Limitations

- Single isolated market only
- Manual oracle (operator-controlled, not decentralized)
- Mock USDC-test debt asset (18 decimals)
- PVM callback probe (Stage 2) reverts due to platform cross-VM callback limitations
- Hackathon governance parameters (short voting/timelock periods)
- Public RPC rate-limited

## Manifest

Canonical: `dualvm/deployments/polkadot-hub-testnet-canonical.json`
