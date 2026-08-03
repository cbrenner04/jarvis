---
name: fan-out-stage-dispatch-preserves-workflow-ownership
---

# Fan-out stage dispatch preserves workflow ownership

## Module-boundary surface

- Execution loop: chained-stage handoff, workflow-start admission, and durable stage-to-run linkage.

## Problem

- Concurrent approved fan-out branches can contend on the completed prior stage's worktree, mark one stage failed, and leave that stage's linked workflow running to success.

## Decisions

- Completed prior-stage worktrees are read-only handoff inputs for sibling dispatch, not ownership targets — rules out timing-dependent contention on the shared predecessor.
- Each fan-out branch dispatch owns only its destination workflow worktree and can reach `running` alongside siblings — rules out a shared predecessor claim serializing or rejecting unrelated branches.
- Once an entry run exists, the stage adopts that run and follows its settlement — rules out a `failed` stage row naming a live invocation that later completes.
- A start refusal records stage failure only when no entry run was admitted and leaves `workflowInvocationId` empty — rules out retaining stale linkage on pre-run failure.
- Retry/backoff for a genuinely claimed destination worktree and `multiple_failed_stages` resume behavior stay unchanged — rules out broadening dispatch recovery.

## Acceptance criteria

- [ ] `daemon-pipeline-approval.test.ts` drives two approved sibling branches through real workflow-start admission in the same scheduling window; both stage rows reach `running` without `worktree_claimed` naming the prior stage, and the regression fails against the baseline.
- [ ] `daemon-pipeline-approval.test.ts` proves every stage linked to a live entry run remains adopted until that run settles and never becomes `failed` while the linked run later completes; the regression fails against the baseline.
- [ ] `pipeline-stage-dispatch.test.ts` proves a genuine pre-run dispatch refusal records `failed` with no `startedAt` or `workflowInvocationId` and never calls wait.
- [ ] Added or changed dispatch guards carry `// @mutate` directives on the real source conditions; the named pinning tests turn RED under each mutation and no production inversion hook is added.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — document claim-free predecessor handoff and the dispatch/linkage invariant.
- `v2/docs/operator-runbook.md` — state that a failed stage has no live linked invocation; a started invocation remains adopted through settlement.
- `v2/docs/v1-behaviors.md` — record the changed v2 fan-out dispatch and stage-linkage behavior.

## Prerequisites

- Fan-out execution persists branch-keyed stage rows and scopes post-approval continuation to the approved branch.
- Chained stage resolution reads each branch input from the preceding workflow artifact and entry-run worktree.
- Daemon workflow-start admission distinguishes refusal before entry-run creation from successful entry-run admission.
