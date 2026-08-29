# Recover review-failed plan stage without redrafting

## Problem

`recoverPlanStage` admits only a `blocked` plan-write row with a `contract_miss` or `blocked` stop, so a completed write followed by a failed review cannot reuse a valid populated `.jarvis-plan-stage/` tree and operators must redraft. Terminal review failures already leave staging bytes on disk (`workflow-runner-review.test.ts` — `review actuator staged Markdown lint exhaustion settles landing_failed with preserved stage`); recovery is unreachable because admission refuses the completed write.

## Decision ledger

- Add a second `recoverPlanStage` admission path requiring a `completed` plan-write row (any write `outcomeKind` — `done`, `no-work`, or `progress` — when staging is populated and valid), a terminal `failed` review/review-debate sibling in the same workflow invocation, and a populated valid `.jarvis-plan-stage/`; rules out treating any failed workflow with leftover staging as recoverable.
- Keep the existing `blocked` write admission path unchanged; rules out weakening or replacing contract-miss recovery.
- Keep recovery identity on the write run (`runId` and `writeStepId` name that row); rules out targeting the failed review row as the recovery owner or accepting operator-supplied run identity.
- Admit review-failed stops only when the evidence review row's last attempt `outcomeKind` is `idle_output_timeout`, quota-classified `invocation_failure`, or another non-landing `invocation_failure`; refuse `landing_failed`, content-specific review rejection, `iteration_timeout`, and other terminal review outcomes through this path; rules out stall-as-`invocation_failure` wording.
- Refuse completed-write review-failed recovery when staged `intent.md` carries any `## Blocker` or other operator-blocker provenance (`operator_blocker`); rules out strip-or-preserve ambiguity on the completed-write path (contract-miss recovery still strips only proven harness blockers).
- Refuse when the evidence review sibling is non-terminal (`in-progress`, `blocked`, or otherwise not `failed`), or when a live run holds the worktree `(project, branch)` claim; rules out racing recovery against concurrent review or mutating staging under live work.
- Extend `resolveBlockedPlanStageRecoveryTarget` / `pipeline_recover` so review-failed plan stages resolve to the same write-run recovery target shape as blocked-write recovery; rules out an execution-only feature unreachable from `jarvis pipeline recover`.
- Recovery review dispatch does not set `freshDispatch`; `buildWorkflowSnapshot` reuses the invocation snapshot from the evidence rows so sibling matching stays in one invocation. `executeWorkflow` mints a fresh review attempt via normal `runReviewDispatch` (no in-place resume of the failed attempt). `commitRecoveredPlanLanding` reads completion attribution from `findRunByProjectBranch` newest-wins on the review `stepId` (the successful recovery review row after landing); rules out attributing from the admission-evidence failed row or a mismatched invocation.
- After review-failed admission, reuse staged validation, review actuator, landing, and `commitRecoveredPlanLanding` with no plan-draft invocation; rules out direct-copy recovery bypassing review contracts.
- Apply normal reviewer quota fallback only within one recovery attempt; a terminal non-quota review failure preserves the staged tree and stops with no automatic retry or redraft; rules out an unbounded recovery-review loop (reachable on base: `recoverPlanStage` performs a single `executeWorkflow` tail with no redrive loop).
- Failed, in-progress, or `blocked` write rows and absent or invalid staged trees remain refused on `unrelated_plan_stage` or `plan_stage_invalid`; rules out masking an incomplete draft as review-only failure.

## Tasks

- Extend `recoverPlanStage` admission: resolve a completed write row plus its terminal failed review sibling (persisted `OutcomeKind` taxonomy above), populated valid staging, no operator blocker, no live worktree claim, and non-terminal review guard; keep request shape unchanged.
- Wire recovery review dispatch and completion attribution per ledger (snapshot reuse, fresh review attempt, newest-wins commit row).
- Extend pipeline recovery resolver/admission for review-failed stages through `jarvis pipeline recover` → `recoverPlanStage`.
- Preserve blocked-write recovery behavior and refuse ineligible write, staging, blocker, live-claim, and review-sibling shapes.

## Acceptance criteria

- [ ] `v2/src/execution/recover-review-failed-plan-draft.test.ts` test `preserves a review-failed staged draft without redrafting` seeds a `completed` plan-write row, a `failed` review sibling whose last attempt is an admitted `OutcomeKind` (e.g. `idle_output_timeout`), and a valid populated `.jarvis-plan-stage/`, invokes `recoverPlanStage` for the write run with captured review step(s), asserts reviewer bindings run, landing and `commitRecoveredPlanLanding` succeed, and the durable tree matches the staged content; it fails against the baseline `unrelated_plan_stage` admission refusal; Mutation checkpoint: the test body carries a `// @mutate` directive inverting the review-failed admission guard and turns RED when applied.
- [ ] `v2/src/execution/recover-review-failed-plan-draft.test.ts` test `quota exhaustion during recovery review falls through to the next configured reviewer in one recovery attempt` seeds a review-failed fixture, exhausts the first reviewer binding with quota during the single `recoverPlanStage` call, completes recovery via the second reviewer without plan-draft bindings, and fails against the baseline refusal before admission widens.
- [ ] `v2/src/execution/recover-review-failed-plan-draft.test.ts` test `a terminal recovery review failure preserves staged bytes in one attempt` covers at least one admitted terminal review outcome (e.g. `idle_output_timeout` on recovery review) and proves staged file bytes are unchanged afterward, recovery settles without landing, and no second recovery invocation or plan-draft binding runs; reachable on base: `recoverPlanStage` has no automatic retry loop today; fails against the baseline admission refusal.
- [ ] `v2/src/execution/recover-review-failed-plan-draft.test.ts` test `refuses review-failed recovery for ineligible write, staging, blocker, live-claim, and review-sibling shapes` pins `unrelated_plan_stage` / `operator_blocker` / `plan_stage_invalid` (or equivalent) for: failed or in-progress write rows; absent or contract-invalid staging; any staged `## Blocker` on the completed-write path; a live `(project, branch)` worktree claim; a non-terminal review sibling; it fails against the baseline admission behavior.
- [ ] `v2/src/daemon/pipeline-stage-recovery.test.ts` test `resolves a review-failed plan stage through pipeline recovery` (new) drives a failed plan stage whose write completed and review failed with admitted evidence, resolves through `resolveBlockedPlanStageRecoveryTarget`, and admits `recoverPlanStage` without plan-writer steps; it fails against the baseline resolver/`stage_not_recoverable` behavior.
- [ ] `v2/src/daemon/pipeline-stage-recovery.test.ts` — `resolves a branch blocked plan stage into a recovery request pinned to the linked run` stays green; `v2/src/daemon/daemon-pipeline-recover.test.ts` — `pipeline_recover admits one branch and advances it without redrafting` stays green.
- [ ] `v2/src/execution/workflow-runner-plan.test.ts` — `recovers an operator-edited plan stage through publication without redrafting` stays green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — review-failed admission evidence (`completed` write plus terminal failed review sibling and persisted `OutcomeKind` set), refusal set (blockers, live claim, non-terminal review, failed/invalid staging), single-shot recovery after quota fallback, dispatch/attribution semantics, expected row state after successful vs terminal recovery failure, staging survival on review failure.
- `v2/docs/v1-behaviors.md` — amend the existing blocked-write-only recovery bullets (~lines 30 and 611) with the additive review-failed path (operator entry, eligibility, and attribution), not a dangling new bullet alone.
- `v2/docs/daemon-host.md` — `pipeline_recover` / resolver admission for review-failed plan stages alongside existing blocked-write recovery.
