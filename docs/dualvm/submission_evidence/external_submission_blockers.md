# External submission blockers observed from this session

## 1. On-chain identity setup

### What was verified
- Official identity guidance says identities are managed on the **People system chain** and require a funded account plus deposit/registrar fee.
- Polkassembly is reachable from this session.
- The identity surface is visible at:
  - `https://polkadot.polkassembly.io/judgements`
- Evidence screenshot saved:
  - `docs/dualvm/submission_evidence/polkassembly-identity-screen.png`

### Exact blocker
This session cannot safely complete the identity step because all three of these conditions are unresolved:
1. **The actual submission account has not been designated by the human team.**
   - Choosing which account permanently represents the project is an irreversible team decision.
2. **The People-chain-funded identity account is not proven ready in this session.**
   - The support guidance explicitly says the account must hold funds on the People parachain for the identity deposit and registrar fee.
3. **This browser session is not authenticated with a wallet-backed Polkassembly account.**
   - No signed account session exists here to complete the identity flow.

### Exact manual action still required
A human operator must:
1. choose the exact submission account
2. fund that account on the People chain for identity deposit/fee
3. log into Polkassembly with that account
4. set identity and complete the required verification/judgement flow
5. save the final visible identity screen plus the tx hash or other on-chain proof

## 2. DoraHacks account / submission access

### What was verified
- The real event page exists:
  - `https://dorahacks.io/hackathon/polkadot-solidity-hackathon/buidl`
- The event page shows `Submit BUIDL`.
- Clicking `Submit BUIDL` redirects to:
  - `https://dorahacks.io/login?redirect_uri=%2Fhackathon%2Fpolkadot-solidity-hackathon%2Fbuidl`
- Evidence screenshots saved:
  - `docs/dualvm/submission_evidence/dorahacks-event-screen.png`
  - `docs/dualvm/submission_evidence/dorahacks-login-blocker.png`

### Exact blocker
This session is not logged into a DoraHacks account that can create or edit the submission entry.

### Exact manual action still required
A human operator must:
1. log in to the correct DoraHacks account
2. verify that the account is the actual submission account
3. create or edit the DualVM Lending submission entry
4. paste the final text from the repo package docs
5. attach screenshots and links
6. publish the entry
7. save the final published submission URL and screenshots of the completed form / published page

## 3. Discord / team verification

### What was verified
- Navigating to `https://discord.com/app` from this session redirects to `https://discord.com/login`.
- Evidence screenshot saved:
  - `docs/dualvm/submission_evidence/discord-login-blocker.png`

### Exact blocker
This session has no authenticated Discord team account, so it cannot prove or complete the required team / Discord verification state for the hackathon.

### Exact manual action still required
A human operator must:
1. log into the team Discord account(s)
2. confirm the required hackathon / Polkadot verification state is complete
3. save screenshots of the verified state

## 4. Existing DoraHacks submission entry presence

### What was verified
- The public BUIDL listing page loads.
- The currently loaded page text does not include `DualVM` or `DualVM Lending` in the visible loaded content.

### Exact limitation of this check
This is not a full proof that no draft exists. It only proves that no visible published/public card matching `DualVM` appeared in the loaded page content during this session.
