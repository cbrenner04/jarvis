# Dispatch core

The daemon's `start` RPC (`v2/src/daemon/daemon.ts` `startHandler`) accepts only
`{ input: WriteLoopInput }`. Extend it to also accept `{ steps: AnyWorkflowStep[] }`,
dispatching to `executeWorkflow` (`v2/src/execution/workflow-runner.ts`) instead of
the existing single-run write-loop path.

## Decisions

- `start`'s params become `{ input: WriteLoopInput } | { steps: AnyWorkflowStep[] }`.
  Both present, neither present, or `steps: []` (empty array) → `invalid_params`,
  same as today's missing-`input` rejection.
- A single-element `steps[]` is valid and follows the normal workflow-start path —
  no minimum length beyond non-empty.
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
- Failure before step 0's run row exists (e.g. `executeWorkflow` rejects on an
  invalid step shape or validation error before `onFirstRunCreated` fires): the
  handler's awaited promise settles with that rejection instead of hanging, and
  `start` returns an error response (surfacing `executeWorkflow`'s thrown error
  message, no new error code) instead of `{ runId }`.
- Workflow-started runs skip the memory-headroom queuing path used by bare
  `WriteLoopInput` starts (`checkMemoryHeadroom()` branch in `startHandler`, which
  today always admits by persisting a `queued` row — it never rejects for
  headroom). No existing rejection code applies here, since the bare path never
  rejects on this branch; the workflow-start path introduces one new code,
  `insufficient_memory`, returned instead of queuing when headroom is
  insufficient. This is the only new error code this subspec adds.
- The workflow-start path persists `workflowSnapshot` through the same
  `executeWorkflow` entry point the existing `implement`-preset path already
  uses — no separate snapshot-writing logic — so subspec 03's rendering reuse
  applies unchanged.
- No new resume/pause/abort semantics here — later subspecs cover ownership,
  `activeRuns`, and `list` rendering for workflow-started runs.

## Acceptance criteria

- [ ] A bare `{ input: WriteLoopInput }` call to `start` behaves exactly as before
      (existing `daemon.test.ts` / equivalent start-handler tests stay green).
- [ ] `start` called with `{ steps: [...] }` (one or more steps) dispatches to
      `executeWorkflow` and returns `{ runId }` for step 0's run once its row is
      durably created.
- [ ] `start` called with both `input` and `steps`, with neither, or with
      `steps: []`, is rejected `invalid_params`.
- [ ] `start` called with `{ steps: [...] }` when `executeWorkflow` fails before
      step 0's run row is created (e.g. an invalid step shape) returns an error
      response rather than hanging.
- [ ] `start` called with `{ steps: [...] }` when memory headroom is insufficient
      is rejected `insufficient_memory` rather than queued.

## Documentation updates

- `v2/docs/daemon-host.md`: update the `start` RPC row to document the
  `{ input } | { steps }` params shape, the workflow-start return behavior, and
  the new `insufficient_memory` rejection (workflow starts reject rather than
  queue on insufficient headroom, unlike the bare-input path).
- `v2/docs/v1-behaviors.md`: not applicable — v1 has no daemon; skip.
