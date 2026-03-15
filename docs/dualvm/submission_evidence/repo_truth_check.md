# Repo truth check

## Git freeze
- Local HEAD: `7b42bd3e39cfdbdec7526588ee14e640467d1928`
- Remote `main` via GitHub API: `7b42bd3e39cfdbdec7526588ee14e640467d1928`
- Working tree status at check time: clean (`## main...origin/main` with no modified files)

## Public surfaces checked
- Hosted frontend: `http://eyawa.me/dualvm-lending/`
  - fetch returned the expected DualVM Lending page content
- Borrow proof tx:
  - `https://blockscout-testnet.polkadot.io/tx/0x658ce8b5e631c3e77d970678e14da986a87a464eca274b1a8585baa65d846ba0`
  - Blockscout returned `Status and method: Success borrow`
- Liquidation proof tx:
  - `https://blockscout-testnet.polkadot.io/tx/0xe8d1f4e36cbbb4c829f2b4d8ee19afc48acc2975e7a29804db9b28099932cef5`
  - Blockscout returned `Status and method: Success liquidate`
- Public repo:
  - GitHub HTML fetch returned 404 from this environment, but GitHub API resolved the repo and `main` commit successfully.

## Saved evidence assets
- Repo screenshot: `docs/dualvm/submission_evidence/github-repo.png`
- Frontend screenshot: `docs/dualvm/screenshots/frontend-home.png`
- Borrow tx screenshot: `docs/dualvm/screenshots/borrow-tx.png`
- Liquidation tx screenshot: `docs/dualvm/screenshots/liquidation-tx.png`
