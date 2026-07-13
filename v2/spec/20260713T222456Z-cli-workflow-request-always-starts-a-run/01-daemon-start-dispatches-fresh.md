# 01 - Daemon workflow start dispatches fresh

`jarvis run workflow <preset>` reaches the daemon as `start { steps }`, which calls
`executeWorkflow` with no dispatch origin. Make that path request a fresh dispatch (subspec `00`),
so a CLI request on a project/branch whose prior run is terminal creates a new run row and invokes
the agent instead of printing the old run id and exiting 0. The daemon's intent invocation-ownership
guard (`daemon.ts` `handleWorkflowStart`) must also stop rejecting a fresh request whose prior run
is terminal.

## Decisions

- Every `start { steps }` is a fresh operator request — rules out a CLI/RPC opt-in flag; there is no
  other `executeWorkflow` caller, and workflow resume is not an operator surface today.
- The invocation-ownership guard (`existing.workflowSnapshot.invocationId !== firstStep.workflowInvocationId`
  → `resume the recorded invocation`) fires only when the existing step run is non-terminal
  (`in-progress`, `revising`, `awaiting-human`, `paused`, `queued`, `budget-soft-stopped`). A
  terminal prior run (`completed`, `failed`, `blocked`, `killed`) no longer blocks a new intent
  request — rules out leaving the guard unconditional, which would make the `intent` preset error
  instead of starting the new run this spec requires.
- Worktree-claim and memory-headroom admission are unchanged: a live run on the same
  `(project, branch)` still rejects `worktree_claimed`.
- Intent durable-output ownership (`intent-output.ts`, keyed by `invocationId`) is unchanged; a new
  invocation writing into a directory holding a prior invocation's files hits the existing
  collision behavior.

## Acceptance criteria

- [ ] `jarvis run workflow implement` on a project/branch whose step run is `completed` prints a new
      run id (not the prior run's) and invokes the agent; `run log <new-id>` carries events for this
      invocation.
- [ ] The same holds for the `intent` and `plan` presets: a request whose prior run is terminal
      starts a new run rather than returning the prior run id or the "owned by another invocation"
      error.
- [ ] A `start { steps }` request while a run for the same `(project, branch)` is live is still
      rejected `worktree_claimed`, and an intent request against a non-terminal prior run of another
      invocation is still rejected with the ownership error.
- [ ] `bun run typecheck` and `bun run test:v2` + `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — a CLI request creates a run unconditionally; step idempotence
  applies only to workflow resume.
- `v2/docs/daemon-host.md` — `start { steps }` dispatches fresh; the intent ownership rejection is
  scoped to non-terminal prior runs.
- `v2/docs/v1-behaviors.md` — record the changed CLI/daemon behavior.
