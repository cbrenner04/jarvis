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
- No new resume/pause/abort RPC surface. `executeWorkflow`'s own snapshot/resume contract (see `v2/docs/workflow-runner.md`) is untouched.

## Task checklist

- [ ] Extend `start`'s params type and dispatch in `v2/src/daemon/daemon.ts`.
- [ ] Derive the ownership key from the first identifiable step for a workflow start; reuse existing claim/queue guards.
- [ ] Background-run `executeWorkflow` for a workflow start, releasing ownership and promoting queued runs on settle, matching `spawnWriteLoop`'s cleanup.
- [ ] Return `{ runId }` for the first step once its run row exists.
- [ ] Update `v2/docs/daemon-host.md`'s `start` RPC row and admission-guards section for the new `steps[]` shape.

## Acceptance criteria

- [ ] `start` called with `{ input: WriteLoopInput }` (no `steps`) is unaffected — existing daemon `start`/`list` tests (`daemon-start-list.test.ts`, `daemon-queue-promotion.test.ts`) stay green.
- [ ] `start` called with `{ steps: AnyWorkflowStep[] }` dispatches to `executeWorkflow` and returns `{ runId }` for the workflow's first step.
- [ ] A workflow start whose first step's `(project, branch)` is already claimed by a live run (bare or workflow) is rejected `worktree_claimed`.
- [ ] `start` called with both `input` and `steps`, or with neither, is rejected `invalid_params`.
- [ ] `list` renders per-step rows for a workflow-started run (existing per-step rendering from `v2/docs/daemon-host.md#workflow-snapshots-on-list-rows`, exercised against a run produced via `start` rather than only via direct `executeWorkflow` calls).

## Documentation updates

- `v2/docs/daemon-host.md`: update the `start` RPC table row and "Admission guards" section to document the `steps[]` input shape and its ownership-key derivation.
