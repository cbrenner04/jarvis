---
name: pipeline-terminal-state-waits-for-stage-settlement
---

# Pipeline terminal state waits for stage settlement

## Module-boundary surface

- Daemon observation: aggregate pipeline state and `pipeline_wait` boundary derivation.

## Problem

- One failed fan-out branch makes the pipeline appear terminal while a sibling workflow is still running or blocked behind an undecided approval gate.

## Decisions

- Any running workflow stage makes aggregate state `running` even when another branch failed or rejected — rules out terminal failure/rejection precedence while work continues.
- A reachable approval gate is a pending or awaiting approval row that is its branch's next unsatisfied non-skipped authored stage after all earlier rows in that branch succeed or are approved; it keeps the aggregate non-terminal after other branches settle unsuccessfully — rules out masking actionable operator decisions with an early terminal result.
- `pipeline_wait` emits terminal only after every non-skipped branch stage has settled — rules out returning while a sibling invocation or approval decision remains live.
- Once every non-skipped stage has settled, any failed stage still derives `failed` under the existing rejected-state precedence — rules out turning delayed terminality into eventual success.
- Retry/backoff and `multiple_failed_stages` resume behavior stay unchanged — rules out coupling observation semantics to recovery policy.

## Acceptance criteria

- [ ] `pipeline-execution.test.ts` proves failed-plus-running fan-out rows derive `running`; the regression fails against the baseline failure-first ordering.
- [ ] `daemon-pipeline-observation.test.ts` proves a failed branch plus an undecided sibling gate that is the branch's next actionable stage remains non-terminal and exposes that approval boundary.
- [ ] `daemon-pipeline-observation.test.ts` holds `pipeline_wait` open for failed-plus-running rows, then returns terminal `failed` only after the running sibling settles; the regression fails against the baseline.
- [ ] `pipeline-execution.test.ts` proves all-settled fan-out rows with at least one failure derive `failed`.
- [ ] Added or changed terminality guards carry `// @mutate` directives on the real source conditions; the named pinning tests turn RED under each mutation and no production inversion hook is added.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — document settlement-first fan-out state and wait-boundary precedence.
- `v2/docs/operator-runbook.md` — state when `pipeline wait` may report terminal after sibling work or gates settle.
- `v2/docs/v1-behaviors.md` — record the changed v2 pipeline terminal-derivation behavior.

## Prerequisites

- Concurrent sibling fan-out dispatch reaches separate `running` stage rows without claiming the completed prior stage's worktree.
- A stage with an admitted entry run adopts that invocation through settlement; a pre-run refusal records no `workflowInvocationId`.
- Pipeline observation derives snapshots and wait boundaries from durable branch-keyed stage rows.
