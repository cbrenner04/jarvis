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

- Fan-out suffix aggregation evaluates `running` before `failed`/`rejected` — rules out failure-first precedence while a sibling workflow stage is live.
- Reachable undecided approval gate (`pending`/`awaiting` row that is the branch's next unsatisfied non-skipped authored stage after satisfied predecessors) keeps aggregate `awaiting-approval` after other branches settle unsuccessfully — rules out masking actionable gates with early terminal failure.
- `pipeline_wait` returns terminal only when `derivePipelineState` is terminal; `pending`/`running` with no approval boundary keep the wait open — rules out returning while a sibling invocation or gate decision remains live.
- After every non-skipped branch stage has settled, preserve existing rejected-before-failed terminal precedence — rules out delayed terminality becoming eventual success.
- Linear `derivePipelineState` walk unchanged — rules out widening scope beyond fan-out suffix aggregation.
- Retry/backoff and `multiple_failed_stages` resume behavior unchanged — rules out coupling observation semantics to recovery policy.

## Task checklist

- Reorder `deriveFanOutSuffixState` to settlement-first precedence: live `running`, then reachable `awaiting-approval`/`pending`, then terminal `rejected`/`failed` only when no unsettled sibling work remains.
- Add fan-out row-seed regressions in `pipeline-execution.test.ts` and live `pipeline_wait` regressions in `daemon-pipeline-observation.test.ts`.
- Place `// @mutate` on each changed suffix guard; link pinning tests that go RED when the guard is inverted.
- Update `v2/docs/daemon-host.md`, `v2/docs/operator-runbook.md`, and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `pipeline-execution.test.ts` proves failed-plus-running fan-out rows derive `running`; the regression fails against baseline failure-first ordering.
- [ ] `daemon-pipeline-observation.test.ts` proves a failed branch plus an undecided sibling gate that is the branch's next actionable stage remains non-terminal and exposes that approval boundary; the regression fails against baseline.
- [ ] `daemon-pipeline-observation.test.ts` holds `pipeline_wait` open for failed-plus-running rows, then returns terminal `failed` only after the running sibling settles; the regression fails against baseline.
- [ ] `pipeline-execution.test.ts` proves all-settled fan-out rows with at least one failure derive `failed`; the regression fails against baseline if running/awaiting precedence is applied after full settlement.
- [ ] Added or changed terminality guards carry `// @mutate` directives on the real source conditions; the named pinning tests turn RED under each mutation and no production inversion hook is added.
- [ ] `pipeline-execution.test.ts` — `"mixed branch failure and success names the failed branchKey while the sibling still reaches terminal success"` stays green.
- [ ] `pipeline-execution.test.ts` — `"returns reopen refusal for ineligible failed shapes without stage dispatch"` (`multiple_failed_stages`) stays green.
- [ ] `bun run typecheck` exits zero.
- [ ] `bun run test:v2` exits zero.
- [ ] `bun run test:integration:v2` exits zero.

## Documentation updates

- `v2/docs/daemon-host.md` — fan-out `derivePipelineState` suffix precedence and `pipeline_wait` boundary rules: unsettled sibling work or reachable gates defer terminal derivation; full settlement restores rejected/failed precedence.
- `v2/docs/operator-runbook.md` — `pipeline wait` may stay non-terminal until sibling branch workflows settle or name an `awaiting-approval` gate; terminal `failed`/`rejected` after all branches settle.
- `v2/docs/v1-behaviors.md` — record changed v2 fan-out pipeline terminal-derivation behavior.
