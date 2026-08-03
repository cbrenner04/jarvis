# Preserve workflow ownership during fan-out dispatch

## Problem

- Concurrent approved fan-out branches can claim the completed predecessor's worktree, fail one stage with `worktree_claimed`, and leave that stage inconsistent with an admitted workflow run.

## Prerequisites

- `pipeline-execution.ts` persists `(stageId, branchKey)` rows and scopes approval continuation to the approved branch.
- `pipeline-stage-resolve.ts` resolves chained inputs from the preceding artifact and entry-run worktree.
- `daemon.ts` distinguishes workflow-start refusal before entry-run creation from admission after the entry run exists.

## Decisions

- Treat a completed predecessor worktree only as a chained-input read root, not a successor ownership key — rules out sibling contention on shared handoff state.
- Give each dispatched branch ownership only of its destination workflow worktree — rules out serializing unrelated sibling branches through the predecessor claim.
- Once workflow start creates an entry run, keep the stage linked and `running` until that run settles — rules out a `failed` stage naming a live run that later completes.
- Record start refusal as stage failure only when no entry run was admitted, leaving `startedAt` and `workflowInvocationId` unset — rules out stale linkage on pre-run failure.
- Preserve destination-worktree claim retry/backoff and `multiple_failed_stages` resume behavior — rules out broad dispatch recovery changes.

## Tasks

- Separate chained predecessor input access from workflow-start ownership during stage resolution and dispatch.
- Make workflow-start admission return or adopt any created entry run before stage failure handling.
- Keep pre-entry-run refusals unlinked and retain existing destination claim and resume behavior.
- Add real-admission concurrent fan-out regression coverage and focused dispatch-refusal coverage.
- Add source mutation directives for every added or changed dispatch guard.
- Update the durable daemon, operator, and v1-parity documentation.

## Acceptance criteria

- [ ] `daemon-pipeline-approval.test.ts` — `concurrent approved sibling branches own destination worktrees` drives two approvals through real workflow-start admission in one scheduling window; both branch stages reach `running`, neither receives `worktree_claimed` for the completed predecessor, and the test fails against the pre-fix code.
- [ ] `daemon-pipeline-approval.test.ts` — `admitted fan-out stages remain adopted through settlement` proves every stage linked to a live entry run remains non-failed until that run settles and never leaves a failed row whose linked run later completes; the test fails against the pre-fix code.
- [ ] `pipeline-stage-dispatch.test.ts` — `pre-run dispatch refusal leaves the stage failed and unlinked` proves a genuine refusal before entry-run admission records `failed` with no `startedAt` or `workflowInvocationId` and never calls wait.
- [ ] Every added or changed dispatch guard has a single-line `// @mutate` directive on the real source condition in `daemon-pipeline-approval.test.ts` or `pipeline-stage-dispatch.test.ts`; applying each mutation independently turns its named pin RED, and production code adds no inversion hook.
- [ ] Existing destination-worktree claim retry/backoff tests and `pipeline-execution.test.ts` `multiple_failed_stages` resume coverage stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/docs/daemon-host.md`, `v2/docs/operator-runbook.md`, and `v2/docs/v1-behaviors.md` state the claim-free predecessor handoff and the invariant that an admitted entry run remains stage-owned through settlement while a failed stage has no live linked invocation.

## Documentation updates

- `v2/docs/daemon-host.md` — claim-free predecessor handoff, destination ownership, and stage/run linkage invariant.
- `v2/docs/operator-runbook.md` — failed-stage diagnosis: no live linked invocation; admitted runs remain adopted through settlement.
- `v2/docs/v1-behaviors.md` — changed v2 fan-out ownership and stage-linkage behavior.
