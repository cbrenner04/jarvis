# Extract patch preflight

## Problem

`v1/src/modes/patch/run.ts` interleaves preflight/spec-path resolution with the iteration loop and completion pipeline. The preflight seam (mode-specific preflight, unmerged-plan-branch warning, active-spec-path preparation) is self-contained and the cleanest first cut.

## Decisions

- Move the preflight seam to a new `v1/src/modes/patch/preflight.ts`; co-locate its private helpers there. Rules out leaving preflight wiring tangled in `run.ts`.
- Anchor functions to relocate: `resolveModeSpecificPreflight`, `maybeWarnAboutUnmergedPlanBranch`, `prepareActiveSpecPath`, `specOutsideWorktreeReadDirs`, plus their supporting helpers (`deriveSpecNameFromPath`, `readRemoteHeadBranch`, `readRemoteHeadSha`, `buildActiveAgents`, `refreshActiveSpecPath`, `findRelocatedSpecFile*`, `copyMissingRecursive`). Rules out an arbitrary cut that splits a helper from its only caller.
- `specOutsideWorktreeReadDirs` relocates wholesale into `preflight.ts` with no re-export — its only caller is internal and moves with it. Rules out re-exporting a symbol no external consumer imports.
- `run.ts` stays the public import path: symbols that external callers (`cli.ts`, `v1/test/run.test.ts`) import — `maybeWarnAboutUnmergedPlanBranch`, `prepareActiveSpecPath` — are re-exported from `run.ts`. Rules out forcing import-path churn on consumers for a no-behavior-change move.
- Shared types `PreflightOk`, `LoggingContext`, `IterationContext`, `IterationOutcome`, `CompletionReadyGateResult` stay defined in `run.ts`; `preflight.ts` (and downstream `iteration.ts`/`completion-pipeline.ts` in 01–02) import them type-only. Rules out introducing a runtime dependency edge or reversing the value-dependency direction (`run.ts → iteration.ts`).
- Refactor-only: relocation + import wiring, no logic edits. Rules out opportunistic cleanup riding along.

## Task checklist

- [ ] Create `preflight.ts` with the preflight/spec-path seam and its private helpers.
- [ ] Rewire `run.ts` to import from `preflight.ts` and re-export the externally-consumed symbols.
- [ ] `bun run typecheck`; `bun run test`.

## Acceptance criteria

- [x] `v1/src/modes/patch/preflight.ts` exists and defines `resolveModeSpecificPreflight`, `maybeWarnAboutUnmergedPlanBranch`, and `prepareActiveSpecPath`.
- [x] `v1/src/modes/patch/run.ts` no longer defines those functions and is shorter than before the change.
- [x] `cli.ts` and `v1/test/run.test.ts` import the same symbols from `v1/src/modes/patch/run.ts` as before (re-exports preserved); no test behavioral assertions change.
- [x] `bun run typecheck` passes.
- [x] `bun run test` passes (modulo pre-existing load-flaky process-timing tests; verified green in isolation — see [[flaky-process-timing-tests-block-runs]]).

## Documentation updates

- None. Internal-only relocation; no operator-facing or behavioral change, so `v2/docs/v1-behaviors.md` is unchanged.
