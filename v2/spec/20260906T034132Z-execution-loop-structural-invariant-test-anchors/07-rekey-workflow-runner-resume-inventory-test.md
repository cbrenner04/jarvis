# Re-key workflow-runner-resume-inventory.test.ts

## Problem

Row `ex-wri-merge-base-titles` in `v2/docs/structural-invariant-test-audit.md` pins resume-path title preservation to a hand-maintained `SOURCE_BUCKETS` list and exact per-bucket destination counts, so new resume tests or co-located file splits red-gate even when merge-base titles remain preserved.

## Decision ledger

- Resume-path source buckets derive from discovered merge-base resume anchors (describe names and repo paths) via a shared inventory helper, not a hand-maintained `SOURCE_BUCKETS` array; rules out static file lists that fail when resume cases move between co-located files.
- Title preservation asserts missing merge-base leaf titles fail and surplus destination titles are allowed, not exact multiset equality with merge-base counts; rules out `destinationCount === expectedCount` pins that block additive resume coverage.
- Merge-base and destination title collection keep the existing leaf-title scanner; rules out replacing it with raw `test()` title string equality against merge-base file bodies.

## Task checklist

- [ ] Re-key audit row `ex-wri-merge-base-titles` per the decision ledger.
- [ ] Replace `SOURCE_BUCKETS` with discovered resume-path buckets from merge-base sources.
- [ ] Narrow inventory assertions to missing-only preservation semantics.

## Acceptance criteria

- [ ] `v2/src/execution/workflow-runner-resume-inventory.test.ts` test `preserves merge-base resume-path leaf titles in workflow-runner-resume*.test.ts destinations` derives source buckets from discovered resume-path anchors rather than a hand-maintained `SOURCE_BUCKETS` list; it fails against the pre-fix static bucket table and passes after re-key.
- [ ] `workflow-runner-resume-inventory.test.ts` test `preserves merge-base resume-path leaf titles in workflow-runner-resume*.test.ts destinations` fails on missing merge-base titles but allows surplus destination titles; it fails against the pre-fix exact-count parity assertion and passes after re-key.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

None — patterns land in `v2/docs/test-writing.md` via a later intent.
