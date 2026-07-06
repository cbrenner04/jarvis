# `start` accepts `steps[]` and dispatches to `executeWorkflow`

The daemon's `start` RPC (`v2/src/daemon/daemon.ts`) currently accepts only
`{ input: WriteLoopInput }` and spawns a single write loop. Extend it to also
accept `{ steps: AnyWorkflowStep[] }` (the type `executeWorkflow` already takes
in `v2/src/execution/workflow-runner.ts`) and dispatch that shape to
`executeWorkflow` instead. Bare `WriteLoopInput` callers are unaffected.

## Decisions

- `start`'s params become `{ input: WriteLoopInput } | { steps: AnyWorkflowStep[] }` — a distinct `steps` key, not an overload of `input`'s shape, so dispatch is unambiguous without shape-sniffing.
- `steps` present (and no `input`) routes to `executeWorkflow`; `input` present (and no `steps`) routes to the existing `executeWriteLoop` path, unchanged. Both present, or neither, is rejected `invalid_params`.
- The double-claim/ownership key for a workflow start is the first identifiable step's `(project, branch)` (same derivation `workflow-runner.ts` already uses internally) — reuses the existing `OwnershipKey` registry and `hasQueuedRun` guard, so a workflow start cannot double-claim a worktree already running a bare or workflow run.
- Workflow starts skip the memory-headroom queuing path (`queuedInput` is typed for one `WriteLoopInput`, not `steps[]`) — insufficient headroom rejects the start with an error rather than queuing. Deferred to first consumer: queuing a multi-step workflow start — pin when an operator/CLI surface needs it (out of scope here).
- Dispatch is fire-and-forget like bare `start`: the RPC returns before the workflow completes; a background task runs `executeWorkflow({ steps, stateStore, logSink })` against the daemon's existing store/logSink instances, matching the `spawnWriteLoop` pattern.
- Success response stays `{ runId: string }`, carrying the first step's run id, so existing `list`/`wait`/`loadRun` callers work unmodified against a workflow-started run.
- **Obtaining the first step's `runId` synchronously:** `WorkflowRunnerInput` (`workflow-runner.ts`) gains an optional `onFirstRunCreated?: (runId: string) => void` hook, invoked synchronously the moment step 0's run row is durably created (from within the existing `prepareWorkflowStep`/`runWorkflowStep` path), before the workflow continues executing. The daemon's workflow-start path awaits that hook firing before resolving the RPC response, then lets `executeWorkflow` keep running in the background — mirroring how the bare path already has `runId` synchronously from its own `store.createRun` call. This is a narrow addition to the input contract, not new resume/pause/abort semantics.
- **Kill/pause against a workflow-started run:** `executeWorkflow` takes no abort/pause signal today, and adding real abort/pause plumbing into it is out of scope here (intent boundary: "no new pause/resume/abort semantics beyond what `executeWorkflow` already defines"). A workflow-started run therefore cannot be killed or paused via the existing `kill`/`pause` RPCs. `activeRuns` entries gain a `kind: "write-loop" | "workflow"` discriminant; a workflow-kind entry carries no `abortController`/`pauseController` wiring. `killHandler`/`pauseHandler` reject a workflow-kind entry's runId with the existing `run_not_active` error (same code already returned for any unmatched runId) rather than silently no-op-ing. Deferred to first consumer: real kill/pause plumbing for a running workflow — pin when an operator/CLI surface needs to interrupt one (out of scope here).
- **Scope of `activeRuns` tracking as a workflow advances:** the daemon's `activeRuns` entry for a workflow start is keyed by the first step's `runId` only, recorded once at spawn and never updated as `executeWorkflow` advances internally to later steps' distinct runids. A `kill`/`pause` call naming a later step's runId does not match the `activeRuns` entry and is rejected `run_not_active`, identically to any other unrecognized runId — later-step runids are explicitly out of matching scope, consistent with the kill/pause deferral above.
- No new resume RPC surface. `executeWorkflow`'s own snapshot/resume contract (see `v2/docs/workflow-runner.md`) is untouched.

## Task checklist

- [ ] Extend `start`'s params type and dispatch in `v2/src/daemon/daemon.ts`.
- [ ] Derive the ownership key from the first identifiable step for a workflow start; reuse existing claim/queue guards.
- [ ] Add `onFirstRunCreated` to `WorkflowRunnerInput` in `workflow-runner.ts`, invoked once step 0's run row is created.
- [ ] Daemon's workflow-start path awaits `onFirstRunCreated` before returning `{ runId }`; `executeWorkflow` continues in the background, releasing ownership and promoting queued runs on settle, matching `spawnWriteLoop`'s cleanup.
- [ ] Add a `kind: "write-loop" | "workflow"` discriminant to `activeRuns` entries; workflow-kind entries carry no abort/pause controllers.
- [ ] `killHandler`/`pauseHandler` reject a workflow-kind (or otherwise-unmatched, post-advance) runId with `run_not_active`.
- [ ] Update `v2/docs/daemon-host.md`'s `start` RPC row and admission-guards section for the new `steps[]` shape, and its "Live controls" section (or equivalent) for the kill/pause limitation.

## Acceptance criteria

- [ ] `start` called with `{ input: WriteLoopInput }` (no `steps`) is unaffected — existing daemon `start`/`list` tests (`daemon-start-list.test.ts`, `daemon-queue-promotion.test.ts`) stay green.
- [ ] `start` called with `{ steps: AnyWorkflowStep[] }` dispatches to `executeWorkflow` and returns `{ runId }` for the workflow's first step only after that step's run row is durably created.
- [ ] A workflow start whose first step's `(project, branch)` is already claimed by a live run (bare or workflow) is rejected `worktree_claimed`.
- [ ] `start` called with both `input` and `steps`, or with neither, is rejected `invalid_params`.
- [ ] `list` renders per-step rows for a workflow-started run (existing per-step rendering from `v2/docs/daemon-host.md#workflow-snapshots-on-list-rows`, exercised against a run produced via `start` rather than only via direct `executeWorkflow` calls).
- [ ] Killing or pausing a workflow-started run (by the `runId` returned from `start`) is rejected `run_not_active`, not silently ignored.
- [ ] Killing or pausing using a later step's runId (once the workflow has advanced past step 0) is rejected `run_not_active`, same as any unrecognized runId.

## Documentation updates

- `v2/docs/daemon-host.md`: update the `start` RPC table row and "Admission guards" section to document the `steps[]` input shape and its ownership-key derivation, plus the kill/pause limitation for workflow-started runs (and its `activeRuns` scoping) as a stated deferral.
