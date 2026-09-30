# Publication in-flow mutation repair before surviving_mutation_failed

## Problem

Ready-finalization diff-derived mutation verification can throw `SurvivingMutationError` during completion publication. The write-loop and workflow-runner publication tails settle terminal `surviving_mutation_failed` immediately (`readyFailed` / `settleWorkflowPublicationFailure`). Bounded `write.mutation-repair` via `runMutationRepairIteration` runs only after operator `jarvis run resume` (`runMutationRepairContinuation` in `workflow-runner-resume.ts`). Reachable today: `write-loop.test.ts` `returns surviving_mutation_failed when mutation verification detects an uncovered changed guard` (ready finalizer stub) and `workflow-runner-publication.test.ts` `settles surviving_mutation_failed as durable failed with resumable terminal details after completion boundary`.

## Decision ledger

- On publication-time `SurvivingMutationError`, run the existing `runMutationRepairIteration` loop (commit, re-verify, republish through `publishWithReadyRepair` per `runMutationRepairAttempt`) before settling `surviving_mutation_failed`; rules out leaving immediate `readyFailed` / workflow publication failure settlement as the first response.
- Share one `MAX_MUTATION_REPAIR_ATTEMPTS` budget across in-flow publication repair and later `jarvis run resume` on the same owning run row by counting prior `write.mutation-repair` iterations already recorded on that row; rules out granting a fresh three-attempt budget on resume after in-flow partial use.
- In-flow blocked, unsettled, or budget-exhausted repair still settles resumable `surviving_mutation_failed` with the latest survivor evidence (same terminal shape as today), not `mutation_repair_exhausted`; rules out mapping first automatic publication repair exhaustion to the resume-only `mutation_repair_exhausted` outcome.
- Wire publication survivor repair through one shared helper on write-loop `publishWithReadyRepair` failure dispatch (`write-loop.ts`), workflow-runner completion publication (`workflow-runner.ts`), and shrink-redirect completion rows (`workflow-runner-review.test.ts` topology); rules out fixing only the write-loop or primary workflow publication seams while shrink-redirect publication keeps immediate settlement.
- Reuse resume-tail repair parameters from the active run's `WriteLoopInput` / `buildCompletionStepWriteLoopInput` bindings (implement-role agents, timeouts, step rules) and auto-derive review-row bindings from the completed write sibling when the publication row lacks inline bindings, mirroring `buildAutoDerivedMutationRepairDeps`; rules out a publication-only repair prompt or binding resolver.
- Leave publication-time `non_terminating_mutation_failed`, ready-gate failures, flip failures, and in-loop `write.surviving-mutation-reprompt` behavior unchanged; rules out folding non-terminating or in-loop discovery into this tail.

## Task checklist

- Extract or export a shared publication-survivor repair driver callable from write-loop and workflow-runner, delegating per-attempt work to `runMutationRepairIteration` and the commit/reverify/republish sequence already used by `runMutationRepairAttempt`.
- Intercept `surviving_mutation_failed` publication failures carrying `SurvivingMutationError` on all publication entry points (write-loop, workflow-runner completion, shrink-redirect durable row); run the bounded loop while budget remains, then settle terminal `surviving_mutation_failed` when repair cannot close the gap.
- Count prior repair attempts on the owning run row toward the shared budget so resume continues with remaining attempts.
- Extend or update `write-loop.test.ts` `returns surviving_mutation_failed when mutation verification detects an uncovered changed guard` (and adjacent ready-finalization coverage) with bindings that still leave the mutant alive after one in-flow repair attempt.
- Update `workflow-runner-publication.test.ts` and `workflow-runner-resume-review-dispatch.test.ts` publication-survivor cases so they expect in-flow repair (and adjusted verify/repair call counts) instead of immediate terminal settlement.
- Update `workflow-runner-review.test.ts` shrink-redirect publication-survivor cases (`readyFinalizer` throws `SurvivingMutationError`) for in-flow repair before terminal settlement on the redirected durable row.
- Update resume-path tests that today assume a full post-terminal `write.mutation-repair` budget on the owning row (e.g. `workflow-runner-resume-review-dispatch.test.ts` auto-derived repair and mutation-repair exhaustion scenarios) so partial in-flow use caps resume attempts.
- Align `v2/docs/write-behavior.md`, `v2/docs/operator-runbook.md`, `v2/docs/v1-behaviors.md`, and `v2/docs/workflow-runner.md` when publication surviving-mutation semantics still read resume-first.

## Acceptance criteria

- [ ] `write-loop.test.ts` `returns surviving_mutation_failed when mutation verification detects an uncovered changed guard` (extend or replace ready-finalization publication coverage): completion publication with a publication-time surviving mutation logs `iteration_started` with prompt id `write.mutation-repair` before `loop_finished` with `loopOutcomeKind: "surviving_mutation_failed"`; fails against the pre-fix immediate terminal settlement reachable on main via that test path.
- [ ] `workflow-runner-publication.test.ts` `settles surviving_mutation_failed as durable failed with resumable terminal details after completion boundary` expects at least one in-flow `write.mutation-repair` iteration before terminal `surviving_mutation_failed`; fails against the pre-fix immediate-settlement path reachable on main.
- [ ] `workflow-runner-resume-review-dispatch.test.ts` publication-time repair-introduced survivor cases expect in-flow repair before terminal settlement and preserve review-row `surviving_mutation_failed` resume admission; fail against the pre-fix `verifyCalls === 1` immediate-settlement behavior reachable on main.
- [ ] `workflow-runner-review.test.ts` `redirects a failed publication tail to the implement step's shrink row when the last step is a non-durable review` expects in-flow `write.mutation-repair` on the redirected shrink row before terminal `surviving_mutation_failed`; fails against the pre-fix immediate-settlement path reachable on main for that shrink-redirect publication topology.
- [ ] A worktree test (extend `workflow-runner-resume-review-dispatch.test.ts` or adjacent resume coverage): after publication records partial in-flow `write.mutation-repair` use on the owning run row, `jarvis run resume` / `resumeReviewMutationFinalization` invokes at most the remaining `MAX_MUTATION_REPAIR_ATTEMPTS` repair agents—not a fresh full budget (e.g. one in-flow attempt then resume caps at two repair invocations before `mutation_repair_exhausted`); fails against pre-fix resume that runs `attempt = 1..MAX` ignoring prior row iterations.
- [ ] `write-loop.test.ts` `returns non_terminating_mutation_failed when publication mutation verification times out` stays green (publication non-terminating settlement unchanged).
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/write-behavior.md` — publication confirm-only surviving mutation runs bounded `write.mutation-repair` in-flow before terminal `surviving_mutation_failed`; shared `MAX_MUTATION_REPAIR_ATTEMPTS` with resume; exhaustion still settles resumable `surviving_mutation_failed`.
- `v2/docs/operator-runbook.md` — first mutation-repair budget runs during publication finalization; `jarvis run resume` is for exhaustion or pause afterward, not the first repair pass.
- `v2/docs/v1-behaviors.md` — publication no longer settles `surviving_mutation_failed` before in-flow mutation repair is exhausted.
- `v2/docs/workflow-runner.md` — completion publication failure and recovery sections match in-flow publication mutation repair and shared attempt counting with resume (no resume-first surviving-mutation settlement).
