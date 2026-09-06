---
name: pipeline-recover-resolves-past-approval-gates
---

# `pipeline recover` reads the immediately-preceding stage, so it never works on `full-review`

## Problem

`jarvis pipeline recover` is the documented way to land a hand-corrected blocked plan stage without redrafting it. On the `full-review` pipeline — the only pipeline configured for the jarvis project — it refuses every time:

```text
$ jarvis pipeline recover 97227fcb-8e6a-45b8-a9c7-d6742af9b297 default
stage_resolution_failed: pipeline-stage-resolve: stage "plan" has no preceding workflow artifact
```

The preceding *workflow* artifact exists. The stage rows at refusal time:

| position | stageId | status | workflowInvocationId | artifact |
| --- | --- | --- | --- | --- |
| 0 | intent | succeeded | `e41629bf…` | set (specPath, prNumber 3504) |
| 1 | approve-intent | approved | none | null |
| 2 | plan | failed | `ff0f7bd3…` | null |

Resolution looks at position 1 — the **approval gate**, which by construction never carries an artifact — instead of walking back to the nearest preceding stage that ran a workflow. Because `full-review` interleaves a gate before every workflow stage, recover can never resolve a plan stage there. The verb is dead on the only configured pipeline, and its failure names a condition ("no preceding workflow artifact") that is false.

Observed 2026-09-06 recovering a plan stage blocked `contract_miss` ("Plan index does not link `00-pin-armed-watchdog-timer-unref.md`"). The contract check was **correct**: the plan agent left an orphaned first-draft subspec beside the rewritten one it linked. That is exactly recover's use case — delete the orphan, land the corrected tree as-is — and the only available fallback was `pipeline resume`, which redrafts and discards the correction.

## Decisions

- Preceding-artifact resolution walks back to the nearest stage that ran a workflow, skipping approval gates and other artifact-less stage kinds; rules out reading position `n-1` unconditionally.
- A refusal that cannot find any preceding workflow stage names the stage kinds it skipped and the positions it inspected; rules out asserting "no preceding workflow artifact" when one exists two positions back.
- Recover admission keys on the blocked stage's own `workflowInvocationId` being set — the linked-stage predicate the runbook already documents — not on its neighbour's artifact; rules out a second, stricter, undocumented gate.

## Acceptance criteria

- [ ] A test proves `pipeline recover` resolves a blocked `plan` stage whose immediately-preceding stage is an approval gate and whose nearest preceding workflow stage carries an artifact; it fails against the current `stage_resolution_failed`.
- [ ] A test proves the refusal for a genuinely artifact-less lineage names the inspected positions and skipped stage kinds rather than a bare "no preceding workflow artifact".
- [ ] A test proves recover admission is unchanged for a pipeline whose stages are adjacent workflow stages with no interleaved gate.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — preceding-workflow-stage resolution skips gate stages.
- `v2/docs/operator-runbook.md` — recover works on gated pipelines; drop the implication that `resume` is the only path for a blocked `full-review` plan stage.
