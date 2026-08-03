---
name: fan-out-stage-linkage-and-dispatch
---

# A fan-out stage records `failed` over its own live invocation, and siblings contend on dispatch

Supersedes `20260803T002657Z-fan-out-stage-dispatch-preserves-workflow-ownership`, whose subspec 00
was built on a premise that is **disproven** — see Non-problems. Prior art: PR #2555 (draft, do not
merge) carries a working adoption implementation and useful tests; lift from it rather than starting
cold, but do not trust its subspec.

## Problem

Approving two intent-split branches dispatched both `plan` stages at once. One stage recorded
`failed` 8.6s in with a claim refusal naming the **prior** stage's workflow, while its own workflow
ran to completion and opened a PR. The pipeline then derived terminal `failed` with a sibling still
`running`.

## Evidence

Pipeline `6155fe8b-3301-45f2-8e67-aa15e093f9de` (`full-review` on `jarvis`), 2026-08-01:

```json
{"stage_id":"plan","branch_key":"tui-pipeline-list-poll","status":"failed",
 "workflow_invocation_id":"30a0dd0e-9657-4e6b-8d4b-349e794fa3af",
 "started_at":1785583658479,"ended_at":1785583667129,
 "failure_detail":{"code":"worktree_claimed",
   "message":"intent: existing workflow is owned by another invocation; resume the recorded invocation"}}
```

`30a0dd0e` — the stage's own recorded invocation — was **live** at that moment and later settled
`completed` with PR #2459.

Reproduced again on 2026-08-03, pipeline `3b97c231`: an implement stage recorded
`harness_failure` / `nextAction: "stop"` while its owning run reported `completion_commit_failed` /
`resumable: true`, and its `workflowInvocationId` named a *different*, completed run than the one
that failed. `startedAt == endedAt`.

## Non-problems — do not re-derive these

Established by adversarial review of PR #2555 against the code:

- **Destination worktrees were already distinct from the predecessor.** Reverting `resolvePlanStage`
  to baseline semantics leaves both ownership regressions green. Plan destinations are
  `plan/${ready.name}`, derived per downstream ready-intent, on `main` too. A
  `destinationDistinctFromPredecessor` predicate asserts an invariant that already held, is called
  only from tests, and enforces nothing. `selectChainedStageCwd` and `PriorArtifactContext.cwd`
  became dead code.
- Adding a `chainedInputRoot` to plan resolution changed the ready-intent **read path**, not
  ownership. That part is worth keeping; the ownership framing around it is not.

## Decisions

- Split this seed into intents along these seams, in this order:
  1. **Linkage follows the entry run.** Once a stage admits an entry run, it stays linked and
     `running` until that run settles; it is never written `failed` while the run is live. A stage's
     failure reason mirrors its owning run's operator error rather than a generic `harness_failure`.
     `workflowInvocationId` is the entry-run ID. This is the reported bug.
  2. **Concurrent sibling dispatch.** Fan-out branches dispatch concurrently instead of serializing
     on `await wait()`. `stageArtifacts` is keyed by `(stageId, branchKey)` — today every branch
     writes the same key, so the current branch can resolve its next stage from a **sibling's**
     artifact, nondeterministically by settle order.
  3. **Claim-safe dispatch.** Two concurrent continuations for one pipeline can both read a stage as
     `pending`, both dispatch, and the loser writes `failed` over the winner's `running` row. Close
     that window with a durable claim taken at partition time, not after dispatch returns.
- A guard whose failure state the fix makes unreachable is proven by an exported pure predicate with
  both truth directions tested, or deleted — not pinned by a mutation directive that cannot fire.
  A predicate with no production call site is not a fix.
- Out of scope: `derivePipelineState` terminality (owned by
  `ready-intents/pipeline-terminal-state-waits-for-stage-settlement`), retry/backoff policy, and the
  `multiple_failed_stages` resume refusal.

## Acceptance criteria

- [ ] A stage whose entry run is live is never `failed`; when that run settles non-success, the stage
      records the run's own operator error reason and `nextAction`.
- [ ] Two sibling branches dispatched from one approved fan-out both reach `running` without either
      failing on a claim naming the predecessor stage.
- [ ] `stageArtifacts` is branch-keyed: a branch resolving its next stage never reads a sibling's
      artifact, proven by a regression with two branches settling in a controlled order.
- [ ] Two concurrent continuations for the same pipeline dispatch a given `(stage, branch)` exactly
      once; the loser neither dispatches nor writes `failed`.
- [ ] `v2/src/daemon/pipeline-execution.test.ts` and `daemon-pipeline-approval.test.ts` complete —
      `bun run test:v2` exits 0. Any fake store used by these files implements every `StateStore`
      method production calls on the dispatch path.
- [ ] The three `pipeline_stage_admission` `StateStore` methods have direct store-level tests
      exercising the real SQL, including the no-row case.
- [ ] `bun run typecheck`, `bun run check`, `bun run lint:md`, `bun run test:v2`, and
      `bun run test:integration:v2` each exit 0.

## Documentation updates

- `v2/docs/daemon-host.md` — stage-to-entry-run linkage identity and failure-reason mirroring.
- `v2/docs/operator-runbook.md` — a `failed` stage never names a live invocation.
- `v2/docs/v1-behaviors.md` — changed v2 fan-out dispatch and linkage behavior.
