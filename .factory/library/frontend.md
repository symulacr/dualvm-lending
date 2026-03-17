# Frontend

Frontend-specific implementation notes and pitfalls.

---

## Manifest wiring
- The frontend statically imports the canonical deployment manifest from `dualvm/src/lib/manifest.ts`; changing `DEPLOYMENT_MANIFEST_PATH` only affects scripts, not the shipped UI.
- `contracts.lendingRouter` is an optional deployment-manifest field. `dualvm/src/components/sections/WritePathSection.tsx` only renders the one-click `Deposit PAS (1-click)` action when that key is present, so deployments that add the router must also add the manifest entry for the UI path to appear.

## Numeric display vs input values
- `dualvm/src/lib/format.ts` uses `Intl.NumberFormat` for display strings such as observer balances and debts.
- Those display strings can include locale grouping separators (for example `1,234.56`) and should not be round-tripped into form state or passed to `parseUnits()` without normalization.
- Max-button or autofill logic should prefer raw numeric on-chain values, or a dedicated normalized string formatter for editable inputs.
