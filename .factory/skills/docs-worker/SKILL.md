---
name: docs-worker
description: Writes and updates documentation, CI configuration, and submission packaging for the DualVM Lending hackathon submission.
---

# Docs Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features that involve:
- README.md, SPEC.md, STATUS.md, features.json rewrites
- Documentation deletion or reorganization
- CI workflow changes (`.github/workflows/ci.yml`)
- Code reduction (consolidating test stubs, deduplicating helpers)
- Submission packaging (DoraHacks submission doc, demo guide)
- PVM narrative writing

## Work Procedure

1. **Read the feature description** and identify what needs to change.

2. **Read current state** of files being modified:
   - For doc rewrites: read the existing file first to understand what it says
   - For CI: read `.github/workflows/ci.yml`
   - For code reduction: count lines before and after (`wc -l`)
   - For features.json: read `dualvm/features.json`

3. **Write documentation** following these rules:
   - Be truthful — no overclaiming
   - Reference specific contract names, addresses, and TX hashes
   - Use the canonical deployment manifest for addresses
   - Distinguish probe-proven PVM interop from product-path PVM integration
   - State known limitations explicitly
   - For README: follow the structure in the existing README but update all content

4. **For code reduction**:
   - Count lines before: `find dualvm/<dir> -name '*.ts' | xargs wc -l | tail -1`
   - Make changes (consolidate, delete dead code)
   - Count lines after
   - Report the delta in the handoff

5. **For CI changes**:
   - Edit `.github/workflows/ci.yml`
   - Ensure new steps use `working-directory: dualvm`
   - Test locally: `cd /home/kpa/polkadot/dualvm && npm test && npx tsc --noEmit && npm run build`

6. **For deletion of stale docs**:
   - List files to be deleted
   - Verify they are not imported/referenced by any code file
   - Delete them
   - Commit with "delete stale docs" message

7. **Verify nothing is broken**: `cd /home/kpa/polkadot/dualvm && npm test && npx tsc --noEmit`

8. **Commit** changes.

## Example Handoff

```json
{
  "salientSummary": "Nuclear rewrite of README.md for consolidated deployment. Deleted 18 stale docs from docs/dualvm/ (~5,800 lines). Created STATUS.md at repo root. Updated SPEC.md to reflect live PVM interop. Updated features.json with current state. Net reduction: 5,200 lines.",
  "whatWasImplemented": "README.md rewritten from scratch (270 lines, consolidated deployment addresses, live proof TX links, current architecture diagram). STATUS.md created (40 lines). SPEC.md updated (removed parity-only language, added versioned market and probe references). features.json updated (pvm-posture now says live interop). Deleted 18 files from docs/dualvm/.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {"command": "cd /home/kpa/polkadot/dualvm && npm test", "exitCode": 0, "observation": "All tests still pass"},
      {"command": "cd /home/kpa/polkadot/dualvm && npx tsc --noEmit", "exitCode": 0, "observation": "No type errors"},
      {"command": "wc -l README.md STATUS.md dualvm/SPEC.md dualvm/features.json", "exitCode": 0, "observation": "README: 270, STATUS: 40, SPEC: 45, features: 120"}
    ],
    "interactiveChecks": []
  },
  "tests": {"added": []},
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Canonical deployment manifest does not exist yet (deployment-worker must create it first)
- Cannot determine current contract addresses (need deployment-worker output)
- Feature requires code changes beyond docs/CI (solidity-worker or frontend-worker)
