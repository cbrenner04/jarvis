---
name: pipeline-fanout-stage-dispatch-contends-on-the-prior-worktree
---

# Fan-out stage dispatch fails on the prior stage's worktree claim, then reports the pipeline terminal while siblings run

## Problem

Approving two intent-split branches in the same pipeline dispatched both `plan` stages at once.
One stage recorded `failed` 8.6s after start with a claim refusal naming the **prior** stage's
workflow, while its own workflow kept running to completion and opened a PR. The pipeline then
derived terminal `failed` while a sibling branch was still `running`.

## Evidence

Pipeline `6155fe8b-3301-45f2-8e67-aa15e093f9de` (`full-review` on `jarvis`), 2026-08-01.
Stage row from `~/.jarvis/state/v2.sqlite`:

```json
{"stage_id":"plan","branch_key":"tui-pipeline-list-poll","status":"failed",
 "workflow_invocation_id":"30a0dd0e-9657-4e6b-8d4b-349e794fa3af",
 "started_at":1785583658479,"ended_at":1785583667129,
 "failure_detail":{"code":"worktree_claimed",
   "message":"intent: existing workflow is owned by another invocation; resume the recorded invocation"}}
```

Facts at that moment:

- `jarvis run list` showed `30a0dd0e` (the stage's own recorded invocation) **live**, and it later settled `completed` with PR #2459.
- The sibling stage `plan/tui-pipeline-tree-model` was still `running`; `jarvis pipeline wait` nevertheless returned `{"kind":"terminal","state":"failed"}`.
- The third branch's gate was correctly still `awaiting` — branch-scoped approval (#2447) worked.
- Both plan branches produced correct specs; only the pipeline's own bookkeeping was wrong.

The claim named `intent`, not `plan`: concurrently dispatched branch stages resolve the same single
prior-stage (intent) worktree for handoff, and the second dispatch loses the claim race.

## Decisions

- Concurrent fan-out dispatch of sibling stages does not contend on a shared prior-stage worktree — either handoff reads the prior artifact without holding the prior workflow's claim, or dispatch serializes per prior worktree. Rules out leaving the race to timing.
- A stage whose dispatch fails does not leave its recorded `workflowInvocationId` running unattended: either the dispatch failure is recorded only when no workflow started, or the started workflow is adopted by the stage. Rules out a `failed` stage row pointing at a live, then successful, invocation.
- Derived pipeline state is not terminal while any stage is `running` or `pending` behind an unapproved gate. Rules out `pipeline wait` returning terminal while work continues.
- Out of scope: retry/backoff policy for a genuinely claimed worktree; the pre-existing `multiple_failed_stages` resume refusal.

## Acceptance criteria

- [ ] Two sibling branch stages dispatched in the same tick from one approved fan-out do not fail with `worktree_claimed` naming the prior stage; both reach `running`.
- [ ] A dispatch that does fail records no `workflowInvocationId`, or the stage adopts the started invocation and follows its outcome — a `failed` stage never names an invocation that later settles `completed`.
- [ ] `derivePipelineState` returns a non-terminal state while any stage is `running`, even when another stage has `failed`; `pipeline wait` does not emit `{"kind":"terminal"}` in that condition.
- [ ] A pipeline whose every non-skipped stage has settled and where at least one failed still derives `failed`.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — pipeline section: what a `failed` stage means for a live invocation, and when `pipeline wait` reports terminal.

## Prerequisites

- `v2/src/daemon/pipeline-stage-dispatch.ts` — stage dispatch and failure recording
- `v2/src/daemon/pipeline-observation.ts` — `derivePipelineState`, `derivePipelineBoundary`
- `v2/src/daemon/pipeline-execution.ts` — post-approval continuation scoped to `branchKey` (#2447)
