# Pin daemon test inventory

## Problem

Handler extraction and new co-located tests can drop or rename cases silently; the spec requires merge-base parity across `v2/src/daemon/**/*.test.ts` but no guard exists yet (`daemon-test-inventory.test.ts` is absent on merge-base).

## Decision ledger

- New `daemon-test-inventory.test.ts` compares merge-base to branch for each `v2/src/daemon/**/*.test.ts` file present on merge-base; rules out manual diff review as the only parity check.
- Net-new co-located unit-test files from subspecs 00–04 are additive and excluded from parity; rules out requiring equality across the full glob including files absent on merge-base.
- Per merge-base file, assert equal case counts and unchanged title sets; renames compare title sets, not path-keyed equality across the full glob; rules out failing when new test files are added alongside preserved inventory.
- Merge-base ref resolves via `git merge-base HEAD main`; empty or failed resolution fails the test explicitly; rules out silent skip or ad-hoc base selection.
- Comparison keys on `test(...)` / `test.skip(...)` titles only; rules out assertion-expression or mutate-directive parity in this slice (out of scope for daemon modularization).
- Inventory runs in the agent slice; rules out a sandbox-unrunnable-only guard for a pure source scan.

## Task checklist

- [ ] Add `daemon-test-inventory.test.ts` that resolves merge-base via `git merge-base HEAD main`, loads merge-base and worktree daemon test inventories for merge-base-present files only, and asserts equal per-file case counts and unchanged title sets.
- [ ] Add a minimal local title scanner for `test(...)` / `test.skip(...)` when no reusable helper exists on merge-base.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-test-inventory.test.ts` merge-base-to-branch comparison reports equal per-file case counts and unchanged title sets for each `v2/src/daemon/**/*.test.ts` file present on merge-base, excluding net-new co-located unit-test files; it fails against the pre-fix tree where the file does not exist.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

None — inventory guard is self-describing in its test header.
