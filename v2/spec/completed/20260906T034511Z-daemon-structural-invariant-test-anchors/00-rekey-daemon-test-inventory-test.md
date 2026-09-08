# Re-key daemon-test-inventory.test.ts

## Problem

Row `dm-test-inv-merge-base-titles` in `v2/docs/structural-invariant-test-audit.md` pins merge-base daemon test inventory to incidental title-count equality, so net-new co-located tests that add coverage without dropping merge-base titles red-gate the suite.

## Decision ledger

- Daemon test file enumeration resolves from merge-base `git ls-tree` under `v2/src/daemon/**/*.test.ts`, not a hand-maintained path list; rules out pins that break on legitimate file renames within the glob.
- Title preservation asserts missing merge-base titles only, not exact multiset equality or per-file count parity with merge-base; rules out blocking additive co-located tests.

## Task checklist

- [x] Re-key audit row `dm-test-inv-merge-base-titles` per the decision ledger.
- [x] Route any merge-base or worktree source slicing through shared loud-failure locators when the inventory reads bounded regions.

## Acceptance criteria

- [x] `daemon-test-inventory.test.ts` test `preserves merge-base test()/test.skip() titles per daemon test file` asserts missing-only title preservation with no exact count equality against merge-base; it fails against the pre-fix per-file case-count parity requirement in `v2/spec/completed/20260902T035309Z-modularize-daemon-run-control-handlers/05-pin-daemon-test-inventory.md` and passes after re-key.
- [x] `daemon-test-inventory.test.ts` test `preserves merge-base test()/test.skip() titles per daemon test file` stays green.
- [x] `bun run typecheck` passes.

## Documentation updates

None — patterns land in `v2/docs/test-writing.md` via a later intent.
