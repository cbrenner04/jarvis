# Recover the named fan-out plan lane

## Problem

`resolveBlockedPlanStageRecoveryTarget` re-resolves a post-split plan stage into the ordinary fan-out `{ results }` shape, then rejects that shape before selecting the named branch. A hand-corrected `.jarvis-plan-stage/` on any fan-out lane therefore has no recovery landing path.

## Decision ledger

- Pair `findFanOutSplit(...).branchKeys[index]` with `resolution.results[index]`, matching ordinary fan-out dispatch ordering; rules out rejecting fan-out wholesale or selecting result zero for every branch.
- Fail `stage_resolution_failed` when the named branch has no paired result; rules out borrowing a neighboring lane's steps or throwing on inconsistent fan-out metadata.
- Drop only the selected result's leading write step, then use its plan-tree review landing pinned to the linked entry run; rules out redispatching the draft or landing a sibling's tree.
- Reopen, settle, and continue only the named branch; rules out changing sibling rows, stages, or approval gates.
- Keep `branchKey` mandatory and preserve `no_failed_stage`, `stage_not_plan`, `stage_not_linked`, and attempt-time `operator_blocker`; rules out broadening recovery admission while enabling fan-out.

## Tasks

- [ ] Update `v2/src/daemon/pipeline-stage-recovery.ts` to accept a successful fan-out resolution, derive `branchIndex` from `split?.branchKeys.indexOf(branchKey) ?? -1`, select `resolution.results[branchIndex]?.steps`, and retain the single-result path for `branchKey: "default"`; keep that selection expression unique for the keystone directive.
- [ ] Refuse `stage_resolution_failed` when resolution itself fails or a fan-out result is absent at the selected branch index; use uniquely mutable real-guard anchors and no test-only inversion hooks.
- [ ] Extend `v2/src/daemon/pipeline-stage-recovery.test.ts` with a non-first branch selection regression, mismatched-result refusal, real corrected-tree recovery, sibling byte-for-byte isolation, and preserved refusal coverage.
- [ ] Extend `v2/src/daemon/daemon-pipeline-recover.test.ts` so `pipeline_recover` admits a non-first named branch from a production-shaped fan-out resolution, lands the corrected tree through review, never invokes the plan write step, and preserves attempt-time and parameter refusals.
- [ ] Update the durable docs listed below.

## Acceptance criteria

- [ ] `v2/src/daemon/pipeline-stage-recovery.test.ts` test `selects the named non-first fan-out result for plan recovery` seeds ordered branches `branch-a`, `branch-b`, and `branch-c`, fails `branch-b`'s plan row, returns distinguishable per-branch write/review results, and proves `resolveBlockedPlanStageRecoveryTarget` chooses `branch-b`'s review landing, drops only its write step, and fails against the pre-fix fan-out refusal. `v2/src/daemon/pipeline-stage-recovery.test.ts` — `selects the named non-first fan-out result for plan recovery`; Keystone checkpoint:
- [ ] The keystone test contains an in-body `// @mutate v2/src/daemon/pipeline-stage-recovery.ts "resolution.results[branchIndex]?.steps" -> "resolution.results[0]?.steps"` directive against a unique real selection expression, so reverting named-branch selection to the first result turns the scoped test red.
- [ ] `v2/src/daemon/pipeline-stage-recovery.test.ts` test `refuses fan-out recovery when the named branch has no paired result` returns `stage_resolution_failed` with no target and contains an in-body directive that inverts the unique `resolvedSteps === undefined` guard; the existing test `refuses an unrecoverable stage target with a named reason` retains an in-body directive that inverts the now-standalone resolution-error guard, and both mutations turn their scoped test red. `v2/src/daemon/pipeline-stage-recovery.test.ts` — `refuses fan-out recovery when the named branch has no paired result`; Mutation checkpoint:
- [ ] `v2/src/daemon/pipeline-stage-recovery.test.ts` exercises successful recovery of a corrected non-first fan-out lane and proves its staged tree lands without a plan write invocation while every sibling row, stage, and approval gate remains byte-for-byte unchanged.
- [ ] `v2/src/daemon/daemon-pipeline-recover.test.ts` test `pipeline_recover admits and lands a corrected non-first fan-out branch without redrafting` invokes `handlers.pipeline_recover` with a production-shaped fan-out resolution, observes the corrected durable tree and named branch continuation, observes no plan write invocation, and fails against the pre-fix fan-out refusal.
- [ ] `v2/src/daemon/pipeline-stage-recovery.test.ts` tests `refuses an unrecoverable stage target with a named reason` and `operator blocker leaves the named fan-out branch failed` stay green for `no_failed_stage`, `stage_not_plan`, `stage_not_linked`, and `operator_blocker`; `v2/src/daemon/daemon-pipeline-recover.test.ts` tests `pipeline_recover refuses invalid params, an unresolvable target, and a retiring daemon` and `pipeline_recover preserves an operator blocker on the named fan-out branch` stay green, including missing/empty `branchKey` refusal and no sibling mutation.
- [ ] `v2/docs/operator-runbook.md` states that `pipeline recover` requires a branch key, accepts any named fan-out lane including a non-first lane, lands the corrected staged tree without redrafting, and leaves sibling lanes unchanged.
- [ ] `v2/docs/daemon-host.md` documents narrowing a successful fan-out resolution by the split artifact's ordinary branch/result ordering, the mismatch refusal, and unchanged recovery guards.
- [ ] `v2/docs/v1-behaviors.md` records named fan-out branch recovery, corrected-tree landing without the write step, and sibling isolation in the v2 parity baseline.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — fan-out branch targeting, mandatory branch key, corrected-tree landing, and sibling isolation.
- `v2/docs/daemon-host.md` — ordered branch/result narrowing, mismatch refusal, and unchanged recovery guards.
- `v2/docs/v1-behaviors.md` — extend the v2 recovery baseline with fan-out branch selection and isolation.
