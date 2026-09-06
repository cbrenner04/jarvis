# CLI structural move-regression guard

## Problem

CLI re-key work can replace path pins with equally brittle path pins that pass when symbols move to a sibling module; the intent requires a guard that fails on fixed-path anchors and passes on symbol-resolved move pairing.

## Decision ledger

- Regression lives in `v2/src/commands/structural-invariant-move-regression.test.ts` as a self-contained fixture exercising the shared move-pairing helper pattern adopted by later subspecs; rules out relying on prose in the audit doc as the only move guard.
- Fixture simulates a guarded symbol extracted from a fixed `OWNER_PATH` into a sibling module: pre-fix path allowlist fails, post-fix export/symbol discovery with absence/presence pairing passes; rules out testing move pairing only inside production module scans without a reachable pre-fix path pin.

## Task checklist

- [x] Add `v2/src/commands/structural-invariant-move-regression.test.ts` with a minimal module-set fixture and a helper that mirrors the re-key pattern used for prepare-call and delegation guards.
- [x] Wire the fixture to fail when the helper still keys on a hardcoded path set and pass when it resolves the owner export and pairs absence outside with presence inside.

## Acceptance criteria

- [x] `v2/src/commands/structural-invariant-move-regression.test.ts` test `re-keyed move guard fails on fixed path allowlist and passes when symbol moves to sibling module` fails against a path-pinned allowlist helper reachable on main and passes after symbol-resolved pairing; it fails against the pre-fix path pin.
- [x] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

None — patterns land in `v2/docs/test-writing.md` via a later intent.
