# Extract patch preflight

## Problem

`v1/src/modes/patch/run.ts` interleaves preflight/spec-path resolution with the iteration loop and completion pipeline. The preflight seam (mode-specific preflight, unmerged-plan-branch warning, active-spec-path preparation) is self-contained and the cleanest first cut.

## Decisions

- Move the preflight seam to a new `v1/src/modes/patch/preflight.ts`; co-locate its private helpers there. Rules out leaving preflight wiring tangled in `run.ts`.
- Anchor functions to relocate: `resolveModeSpecificPreflight`, `maybeWarnAboutUnmergedPlanBranch`, `prepareActiveSpecPath`, `specOutsideWorktreeReadDirs`, plus their supporting helpers (`deriveSpecNameFromPath`, `readRemoteHeadBranch`, `readRemoteHeadSha`, `buildActiveAgents`, `refreshActiveSpecPath`, `findRelocatedSpecFile*`, `copyMissingRecursive`). Rules out an arbitrary cut that splits a helper from its only caller.
- `run.ts` stays the public import path: symbols that external callers (`cli.ts`, `v1/test/run.test.ts`) import — including `maybeWarnAboutUnmergedPlanBranch`, `prepareActiveSpecPath`, `specOutsideWorktreeReadDirs` — are re-exported from `run.ts`. Rules out forcing import-path churn on consumers for a no-behavior-change move.
- Refactor-only: relocation + import wiring, no logic edits. Rules out opportunistic cleanup riding along.

## Task checklist

- [ ] Create `preflight.ts` with the preflight/spec-path seam and its private helpers.
- [ ] Rewire `run.ts` to import from `preflight.ts` and re-export the externally-consumed symbols.
- [ ] `bun run typecheck`; `bun run test`.

## Acceptance criteria

- [ ] `v1/src/modes/patch/preflight.ts` exists and defines `resolveModeSpecificPreflight`, `maybeWarnAboutUnmergedPlanBranch`, and `prepareActiveSpecPath`.
- [ ] `v1/src/modes/patch/run.ts` no longer defines those functions and is shorter than before the change.
- [ ] `cli.ts` and `v1/test/run.test.ts` import the same symbols from `v1/src/modes/patch/run.ts` as before (re-exports preserved); no test behavioral assertions change.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test` passes.

## Documentation updates

- None. Internal-only relocation; no operator-facing or behavioral change, so `v2/docs/v1-behaviors.md` is unchanged.
