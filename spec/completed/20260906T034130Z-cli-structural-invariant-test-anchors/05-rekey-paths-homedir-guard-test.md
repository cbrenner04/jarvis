# Re-key v2/src/paths.test.ts homedir guard and audit closure

## Problem

Row `cli-paths-homedir-guard` in `v2/docs/structural-invariant-test-audit.md` scans all `v2/src` production sources for `homedir()` via substring match without loud-failure routing; the intent also requires every CLI `re-key` inventory row to land before this spec closes.

## Decision ledger

- `cli-paths-homedir-guard` keeps the production-tree walk but treats `paths.ts` as the canonical homedir site via explicit allow pairing, not an implicit substring scan that vacuously passes when the walk root is wrong; rules out offender discovery without naming the allowed module.
- Offender file reads in the homedir guard route through `locateDiscoveredFile` when building the scanned source map; rules out silent empty offender lists when a relative path key is missing from the discovery record.

## Task checklist

- [x] Re-key audit row `cli-paths-homedir-guard` per the decision ledger.
- [x] Confirm rows `cli-hfp-guarded-paths`, `cli-init-profile-files`, `cli-wsp-posture-tables`, `cli-wsp-single-owner`, `cli-wsp-prepare-calls`, `cli-wf-stale-reset-workflows`, `cli-wf-prep-call-count`, and `cli-wf-prep-delegation` are covered by subspecs 01–04.

## Acceptance criteria

- [x] `v2/src/paths.test.ts` test `no v2 source resolves a jarvis-home path via homedir() directly` pairs homedir absence outside `paths.ts` with explicit allowance on the canonical paths module via loud-failure discovery; it fails against the pre-fix substring-only scan reachable in that test and passes after re-key.
- [x] Every CLI structural-invariant test tagged `re-key` in `v2/docs/structural-invariant-test-audit.md` anchors on its source of truth or remains `stay-incidental` per the audit with loud-failure locator routing only.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

None — patterns land in `v2/docs/test-writing.md` via a later intent.
