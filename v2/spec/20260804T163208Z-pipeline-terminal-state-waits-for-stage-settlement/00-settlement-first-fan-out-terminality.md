# Settlement-first fan-out terminality

## Problem

Fan-out suffix aggregation in `deriveFanOutSuffixState` applies `failed`/`rejected` before `running` and before reachable approval gates. One settled failed branch makes aggregate state and `pipeline_wait` terminal while a sibling workflow is still running or blocked on an undecided gate.

## Surface

`v2/src/daemon/pipeline-execution.ts` (`deriveFanOutSuffixState`, fan-out path of `derivePipelineState`). In-scope: `pipeline-execution.test.ts`, `daemon-pipeline-observation.test.ts`, `pipeline-observation.ts` only if boundary derivation needs alignment after the state fix.

Out of scope: fan-out dispatch/claim, entry-run linkage, retry/backoff, `multiple_failed_stages` resume policy, linear (non-fan-out) `derivePipelineState` walk.

## Prerequisites

- Concurrent sibling fan-out dispatch reaches separate `running` stage rows without worktree-claim false positives (`pipeline-execution.test.ts` linear fan-out concurrency tests).
- Admitted entry runs adopt `workflowInvocationId` through settlement; pre-run refusal leaves it `null` (`fan-out re-entry with deferred-settlement admitted entry run…`).
- `pipeline_list` / `pipeline_wait` observe durable branch-keyed stage rows (`pipeline-observation.ts`, `daemon-pipeline-observation.test.ts`).

## Decisions

- Fan-out suffix aggregation defers terminal `failed`/`rejected` only while **actionable** sibling work remains: live `running`, or unsatisfied non-skipped stages whose branch predecessors are satisfied (reachable-gate rule) — rules out failure-first precedence while actionable work continues and rules out dead-branch `pending` rows on terminally failed/rejected branches beating post-settlement `rejected`.
- Terminally failed/rejected branches count as settled for deferral even when branch completion flags remain false — rules out naive `anyPending` deferral regressing mixed-branch rejection after the rejected branch settles.
- Reachable undecided approval gate (`pending`/`awaiting` row that is the branch's next unsatisfied non-skipped authored stage after satisfied predecessors) keeps aggregate `awaiting-approval` after other branches settle unsuccessfully — rules out masking actionable gates with early terminal failure.
- `pipeline_wait` returns terminal only when `derivePipelineState` is terminal; actionable `pending`/`running` with no approval boundary keep the wait open — rules out returning while a sibling invocation or gate decision remains live.
- After every non-skipped branch stage has settled, preserve existing rejected-before-failed terminal precedence — rules out delayed terminality becoming eventual success.
- Linear `derivePipelineState` walk unchanged — rules out widening scope beyond fan-out suffix aggregation.
- Retry/backoff and `multiple_failed_stages` resume behavior unchanged — rules out coupling observation semantics to recovery policy.

## Task checklist

- Refactor `deriveFanOutSuffixState` to settlement-first precedence on actionable signals: live `running`, then reachable `awaiting-approval`/`pending` (unsatisfied non-skipped stages with satisfied branch predecessors), then terminal `rejected`/`failed` only when no actionable sibling work remains; treat terminally failed/rejected branches as settled for deferral.
- Add fan-out row-seed regressions in `pipeline-execution.test.ts` (failed-plus-running and rejected-plus-running) and live `pipeline_wait` regressions in `daemon-pipeline-observation.test.ts`.
- Place `// @mutate` on each new or moved suffix guard condition (including actionable-pending logic), not only reordered `anyRejected`/`anyFailed`/`anyRunning` returns; link pinning tests that go RED when each real production condition is inverted.
- Update `v2/docs/daemon-host.md` (reconcile the sentence that terminal states take precedence over approval boundaries), `v2/docs/operator-runbook.md`, and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [x] `pipeline-execution.test.ts` proves failed-plus-running fan-out rows derive `running`; the regression fails against baseline failure-first ordering.
- [x] `pipeline-execution.test.ts` proves rejected-plus-running fan-out rows derive `running`; the regression fails against baseline failure-first ordering.
- [x] `daemon-pipeline-observation.test.ts` proves a failed branch plus an undecided sibling gate that is the branch's next actionable stage remains non-terminal and exposes that approval boundary; the regression fails against baseline.
- [x] `daemon-pipeline-observation.test.ts` holds `pipeline_wait` open for failed-plus-running rows, then returns terminal `failed` only after the running sibling settles; the regression fails against baseline.
- [x] `pipeline-execution.test.ts` proves all-settled fan-out rows with at least one failure derive `failed`; the regression fails against baseline if running/awaiting precedence is applied after full settlement.
- [x] Each new or moved suffix guard condition (including actionable-pending logic) carries a `// @mutate` directive on the real production condition it guards; the named pinning tests turn RED under each mutation and no production inversion hook is added.
- [x] `pipeline-execution.test.ts` — `"mixed branch failure and success names the failed branchKey while the sibling still reaches terminal success"` stays green.
- [x] `pipeline-execution.test.ts` — `"mixed branch rejection and success names the rejected branchKey without aborting the sibling"` stays green.
- [x] `pipeline-execution.test.ts` — `"returns reopen refusal for ineligible failed shapes without stage dispatch"` (`multiple_failed_stages`) stays green.
- [x] `bun run typecheck` exits zero.
- [x] `bun run test:v2` exits zero.
- [x] `bun run test:integration:v2` exits zero.

## Documentation updates

- `v2/docs/daemon-host.md` — reconcile the sentence that terminal states take precedence over approval boundaries; document settlement-first fan-out suffix precedence and `pipeline_wait` boundary rules: aggregate state and `pipeline_wait` stay non-terminal while actionable sibling work or reachable gates remain; terminal `failed`/`rejected` only after full branch settlement restores rejected-before-failed precedence.
- `v2/docs/operator-runbook.md` — `pipeline wait` may stay non-terminal until sibling branch workflows settle or name an `awaiting-approval` gate; terminal `failed`/`rejected` after all branches settle.
- `v2/docs/v1-behaviors.md` — record changed v2 fan-out pipeline terminal-derivation behavior.
