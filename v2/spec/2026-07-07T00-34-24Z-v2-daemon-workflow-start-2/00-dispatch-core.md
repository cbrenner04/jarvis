# Dispatch core

The daemon's `start` RPC (`v2/src/daemon/daemon.ts` `startHandler`) accepts only
`{ input: WriteLoopInput }`. Extend it to also accept `{ steps: AnyWorkflowStep[] }`,
dispatching to `executeWorkflow` (`v2/src/execution/workflow-runner.ts`) instead of
the existing single-run write-loop path.

## Decisions

- `start`'s params become `{ input: WriteLoopInput } | { steps: AnyWorkflowStep[] }`.
  Both present or neither present → `invalid_params`, same as today's missing-`input`
  rejection.
- `steps` is a distinct key, not an overload of `input`'s shape — no shape-sniffing.
- Add `onFirstRunCreated?: (runId: string) => void` to `WorkflowRunnerInput`. It fires
  once step 0's run row is durably created (i.e. once `executeWorkflow`'s internal
  step-0 `createRun`/`findRunByProjectBranch` path has produced a row), before any
  step executes.
- The workflow-start path calls `executeWorkflow` with `onFirstRunCreated` set to a
  callback that resolves a promise the handler awaits; once resolved, `start` returns
  `{ runId }` for step 0 and lets `executeWorkflow` continue running in the
  background (fire-and-forget, matching how `spawnWriteLoop` backgrounds a bare
  write-loop run today).
- Workflow-started runs skip the memory-headroom queuing path used by bare
  `WriteLoopInput` starts (`checkMemoryHeadroom()` branch in `startHandler`):
  insufficient headroom rejects the workflow start outright rather than queuing it.
- No new resume/pause/abort semantics here — later subspecs cover ownership,
  `activeRuns`, and `list` rendering for workflow-started runs.

## Acceptance criteria

- [ ] A bare `{ input: WriteLoopInput }` call to `start` behaves exactly as before
      (existing `daemon.test.ts` / equivalent start-handler tests stay green).
- [ ] `start` called with `{ steps: [...] }` dispatches to `executeWorkflow` and
      returns `{ runId }` for step 0's run once its row is durably created.
- [ ] `start` called with both `input` and `steps`, or with neither, is rejected
      `invalid_params`.
- [ ] `start` called with `{ steps: [...] }` when memory headroom is insufficient is
      rejected rather than queued.

## Documentation updates

- `v2/docs/daemon-host.md`: update the `start` RPC row to document the
  `{ input } | { steps }` params shape and the workflow-start return/queuing
  behavior.
- `v2/docs/v1-behaviors.md`: not applicable — v1 has no daemon; skip.
