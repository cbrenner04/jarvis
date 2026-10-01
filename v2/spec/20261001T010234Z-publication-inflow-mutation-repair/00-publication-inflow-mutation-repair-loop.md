# Publication in-flow mutation repair loop

## Problem

`publishWithReadyRepair` returns the first `publishCompletionArtifacts` `surviving_mutation_failed` outcome immediately (`buildReadyRepairPublishResult` at the non-ready-gate early return). `write.mutation-repair` runs only after operator `jarvis run resume` (`workflow-runner-resume.ts` `runMutationRepairContinuation`). Reachable on main via `write-loop.test.ts` `"returns surviving_mutation_failed when mutation verification detects an uncovered changed guard"`, which expects terminal settlement with no preceding mutation-repair `iteration_started`.

## Decision ledger

- On publication-time `SurvivingMutationError` from ready finalization, drive the existing `runMutationRepairIteration` repair driver in-flow inside the `publishWithReadyRepair` / completion-publication tail before `readyFailed` / terminal `surviving_mutation_failed` settlement; rules out leaving first discovery as immediate terminal settlement while repair exists only on resume.
- Share one `MAX_MUTATION_REPAIR_ATTEMPTS` (3) budget between in-flow publication repair and later `jarvis run resume` mutation-repair continuation on the same run row; rules out independent per-phase budgets that allow up to six repair iterations.
- After in-flow budget exhaustion or a blocked/unsettled repair iteration on the write-loop publication tail, settle terminal `surviving_mutation_failed` with `resumable: true` and the same survivor evidence shape as today; rules out settling `mutation_repair_exhausted` on the implement write row or changing review-row `mutation_repair_exhausted` semantics.
- Extract or centralize the commit → push-only republish → reverification → optional `publishWithReadyRepair` retry sequence already implemented in `workflow-runner-resume.ts` `runMutationRepairAttempt` so in-flow and resume share one implementation; rules out duplicating divergent repair tails.
- Run the multi-attempt in-flow mutation-repair loop only on the implement write-loop completion-publication tail (outer `publishWithReadyRepair` from completion publication); resume `runMutationRepairAttempt` republishes via `publishWithReadyRepair` in single-shot mode without re-entering that loop; rules out nested repair loops or budget reset when resume republication hits `publishWithReadyRepair` again.
- File ownership: this subspec owns `publishWithReadyRepair` survivor dispatch and the shared publication mutation-repair driver; `01-mutation-repair-attempt-guards.md` owns per-iteration HEAD/killing-test/timeout guards on that shared driver. Do not edit shrink in-loop verification (`20260930T170446Z-shrink-post-mutation-reverify`).

## Task checklist

- Intercept `surviving_mutation_failed` from the initial (and retried) `publishCompletionArtifacts` path in `publishWithReadyRepair` and enter the shared mutation-repair loop before returning failure to the write loop / workflow completion tail.
- Persist or derive consumed mutation-repair attempt count on the durable run so resume continues the shared budget.
- Wire implement/write-loop bindings and timeouts needed for `runMutationRepairIteration` at publication time (same seam resume auto-derivation uses).
- Extend `write-loop.test.ts` and `workflow-runner-resume-review-dispatch.test.ts` per acceptance criteria (in-flow cap, shared budget across resume, nested `publishWithReadyRepair` single-shot on resume republish).
- Align `v2/docs/write-behavior.md`, `v2/docs/operator-runbook.md`, and `v2/docs/v1-behaviors.md` with in-flow repair before terminal settlement and shared resume budget.

## Acceptance criteria

- [ ] `write-loop.test.ts` (extend ready-finalization / publication surviving-mutation coverage): completion publication with a publication-time surviving mutation logs `iteration_started` for a `write.mutation-repair` iteration (binding or session evidence naming prompt id `write.mutation-repair`) before `loop_finished` with `loopOutcomeKind: "surviving_mutation_failed"`; fails against the pre-fix path in `"returns surviving_mutation_failed when mutation verification detects an uncovered changed guard"`, which settles without that repair iteration.
- [ ] `write-loop.test.ts` adds in-flow exhaustion coverage: publication-time surviving mutation drives exactly `MAX_MUTATION_REPAIR_ATTEMPTS` `write.mutation-repair` `iteration_started` events before `loop_finished` with `loopOutcomeKind: "surviving_mutation_failed"` and `resumable: true` (write row does not settle `mutation_repair_exhausted`); fails against `"returns surviving_mutation_failed when mutation verification detects an uncovered changed guard"`, which settles on first survivor with zero repair iterations.
- [ ] `write-loop.test.ts` and/or `workflow-runner-resume-review-dispatch.test.ts`: after publication in-flow consumes part of the shared `MAX_MUTATION_REPAIR_ATTEMPTS` budget and settles resumable `surviving_mutation_failed`, `jarvis run resume` continues from the persisted attempt count (no reset to attempt 1, no fresh cap of 3) and resume republish does not run a second nested in-flow repair loop; fails pre-fix when `runMutationRepairContinuation` always opens at attempt 1 regardless of durable consumption.
- [ ] `write-loop.test.ts` publication tail: in-flow mutation repair that returns `unsettled` or `blocked` before budget exhaustion settles `loopOutcomeKind: "surviving_mutation_failed"` with `resumable: true` and session events omit `mutation_repair_exhausted` on the implement write row; fails against an implementation that maps publication-time `unsettled`/`blocked` repair to `mutation_repair_exhausted`.
- [ ] `workflow-runner-resume-review-dispatch.test.ts` `"surviving_mutation_failed resume without explicit mutationRepair auto-derives write.mutation-repair before re-verification"` stays green (resume path unchanged aside from shared budget accounting).
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/write-behavior.md` — publication confirm-only surviving mutation triggers in-flow `write.mutation-repair` (bounded, shared budget with resume) before terminal `surviving_mutation_failed`; resume after exhaustion continues repair, not first discovery.
- `v2/docs/operator-runbook.md` — first mutation-repair budget runs in-flow at publication; operator `jarvis run resume` is for exhaustion, pause, or out-of-band worktree drift—not the first repair pass after publication-time discovery.
- `v2/docs/v1-behaviors.md` — **[v2 behavior change]** publication no longer settles terminal `surviving_mutation_failed` before in-flow mutation repair is exhausted on the owning write row.
