# Re-key v2/src/cli/help-flags-parity.test.ts

## Problem

Row `cli-hfp-guarded-paths` in `v2/docs/structural-invariant-test-audit.md` keys parity coverage to hand-maintained `PARITY_PATHS` in `help-flags-parity.ts`, so new command-tree leaves can pass with zero gaps while remaining unguarded.

## Decision ledger

- Parity-scoped help paths derive from the committed `commandTree` leaf set intersected with parser surfaces that expose long flags, not a second hand-maintained path array; rules out `PARITY_PATHS` as the source of truth beside `commandTree`.
- Unknown or missing help nodes fail through loud-failure resolution when building the parity path set; rules out `helpFlagsParityGaps()` returning `[]` when a listed path disappears from the tree.

## Task checklist

- [ ] Re-key audit row `cli-hfp-guarded-paths` per the decision ledger.
- [ ] Replace `PARITY_PATHS` with tree-derived discovery in `v2/src/cli/help-flags-parity.ts` and keep behavioral delta cases in `help-flags-parity.test.ts` on the exported gap helper.

## Acceptance criteria

- [ ] `v2/src/cli/help-flags-parity.test.ts` test `every guarded path lists all parser-accepted flags` derives its guarded path set from `commandTree` discovery rather than a hand-maintained `PARITY_PATHS` list; it fails against the pre-fix `PARITY_PATHS` constant reachable in `help-flags-parity.ts` and passes after re-key.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

None — patterns land in `v2/docs/test-writing.md` via a later intent.
