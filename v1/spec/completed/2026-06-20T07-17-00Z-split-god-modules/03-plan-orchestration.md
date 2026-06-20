# Extract plan orchestration, args-only command

## Problem

`v1/src/commands/plan.ts` (~1.5k LOC) mixes CLI concerns with full plan-phase orchestration (`planCommand` ~750 LOC) plus resume, validation, cleanup, and PR helpers. Plan-mode logic should live under `v1/src/modes/plan/` (alongside `draft.ts`, `review.ts`, `pr.ts`, …), leaving `commands/plan.ts` as the args-only command layer.

## Decisions

- Move plan orchestration to a new `v1/src/modes/plan/run.ts`: `planCommand` and its plan-only helpers (resume/validation/cleanup/PR helpers such as `prepareResume`, `computeResumeCounters`, `cleanupCommittedTempPlanState`, `ensureUniquePlanName`, `validateReadyIntent`, `parseIntentFrontmatter`, `resolveResumeSpecPath`, `renderPlanNextSteps`, `deleteReadyIntentFromWorktree`, `isPathInside`, `injectRepoLineIntoIndex`, `safeUpdatePrBody`, `safeMarkPlanPrReady`, and their private helpers). Rules out leaving orchestration in the CLI command module.
- `commands/plan.ts` becomes args-only: it owns `PLAN_USAGE`/`PlanIo`/`PlanCommandOptions`, delegates argument handling to the existing `commands/plan-args.ts`, and re-exports the orchestration entry plus the symbols `v1/test` imports (`planCommand`, `parseIntentFrontmatter`, `renderPlanNextSteps`, `resolveResumeSpecPath`, `validateReadyIntent`, `injectRepoLineIntoIndex`, `deleteReadyIntentFromWorktree`, `isPathInside`). Rules out breaking `cli.ts`/test import paths for a no-behavior-change move.
- Refactor-only: relocation + import wiring, no logic edits. Rules out folding plan behavior tweaks into the split.

## Task checklist

- [ ] Create `v1/src/modes/plan/run.ts` with the plan orchestration seam and its private helpers.
- [ ] Reduce `commands/plan.ts` to CLI arg handling + re-exports of the consumed symbols.
- [ ] `bun run typecheck`; `bun run test`.

## Acceptance criteria

- [x] `v1/src/modes/plan/run.ts` exists and defines `planCommand`.
- [x] `v1/src/commands/plan.ts` no longer defines `planCommand`'s orchestration body and is substantially thinner (args + re-exports).
- [x] `cli.ts` and the `v1/test/plan-*` / `v1/test/modes/plan/*` suites import the same symbols from `v1/src/commands/plan.ts` as before (re-exports preserved); no test behavioral assertions change.
- [x] `bun run typecheck` passes.
- [x] `bun run test` passes.

## Documentation updates

- None required. Internal-only relocation; no operator-facing or behavioral change, so `v2/docs/v1-behaviors.md` is unchanged. (Existing doc source pointers reference `src/commands/plan.ts` at module granularity and stay accurate via re-exports.)
