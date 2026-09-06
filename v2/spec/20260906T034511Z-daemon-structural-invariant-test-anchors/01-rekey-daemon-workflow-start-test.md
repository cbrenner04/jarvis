# Re-key daemon-workflow-start.test.ts

## Problem

Row `dm-workflow-start-admission-seam` in `v2/docs/structural-invariant-test-audit.md` pins daemon admission routing to incidental handler symbol names and a hand-maintained module filename list, so legitimate handler extractions and renames red-gate while `admitWorkflowStart` routing still holds.

## Decision ledger

- Handler bodies are located via `locateSymbolSlice` over production sources discovered from a `v2/src/daemon/**/*.ts` glob, not a hand-maintained filename array; rules out red-gates when handlers move between sibling modules.
- Admission routing asserts that workflow start, pipeline dispatch, and recovery call `admitWorkflowStart` without bypassing ownership or memory guards, not substring pins on incidental handler declaration names; rules out rename red-gates while admission semantics hold.
- Section and symbol slicing routes through `shared/structural-test-locator.ts`; rules out local `section()` returning an empty slice when the end anchor is absent (reachable on main via `daemon-workflow-start.test.ts` local `section()` when `toIndex === -1`).

## Task checklist

- [x] Re-key audit row `dm-workflow-start-admission-seam` per the decision ledger.
- [x] Replace local `section()` with shared loud-failure symbol slicing.
- [x] Add a regression case that survives handler symbol rename when admission routing is unchanged.

## Acceptance criteria

- [x] `daemon-workflow-start.test.ts` test `workflow starts, pipeline dispatch, and recovery share daemon admission` derives admission routing from property assertions over `admitWorkflowStart` call sites, not incidental handler symbol-name section pins; it fails against the pre-fix `const handleWorkflowStart` / `const pipeline_recover` anchor pins on audit row `dm-workflow-start-admission-seam` and passes after re-key.
- [x] `daemon-workflow-start.test.ts` test `workflow starts, pipeline dispatch, and recovery share daemon admission` stays green.
- [x] `daemon-workflow-start.test.ts` includes a regression case that fails when admission routing still pins an incidental handler symbol name and passes after a symbol rename that preserves `admitWorkflowStart` routing; it fails against pre-fix symbol-name section pins.
- [x] `bun run typecheck` passes.

## Documentation updates

None — patterns land in `v2/docs/test-writing.md` via a later intent.
