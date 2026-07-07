# activeRuns discriminant + kill/pause

Depends on [00 - Dispatch core](./00-dispatch-core.md) and
[01 - Ownership guard](./01-ownership-guard.md). `activeRuns`
(`v2/src/daemon/daemon.ts`) currently holds one flat shape per live write-loop run.
A workflow-started run needs a tracked entry too, so `kill`/`pause` reject it
explicitly rather than only by absence.

## Decisions

- Add `kind: "write-loop" | "workflow"` to `ActiveRun` entries. Bare write-loop starts
  set `kind: "write-loop"` (unchanged behavior otherwise).
- A workflow start's `activeRuns` entry has `kind: "workflow"` and carries no
  `abortController`/`pauseController` (deferred: real kill/pause plumbing for a
  running workflow is a first-consumer concern, per the parent intent).
- `killHandler`/`pauseHandler` check the entry's `kind`: a `"workflow"` entry (for
  the started run or any later step's runId within that workflow invocation) is
  rejected `run_not_active`, same error code as an absent/mismatched entry today.

## Acceptance criteria

- [ ] Killing a workflow-started run's step-0 runId is rejected `run_not_active`.
- [ ] Pausing a workflow-started run's step-0 runId is rejected `run_not_active`.
- [ ] Killing/pausing a later step's runId (once that step's run row exists) is also
      rejected `run_not_active`.
- [ ] Bare write-loop kill/pause behavior is unchanged (existing kill/pause tests
      stay green).

## Documentation updates

- `v2/docs/daemon-host.md`: note in the live-controls section that `kill`/`pause`
  reject workflow-started runs with `run_not_active`.
