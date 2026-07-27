# Dispatch and record one workflow stage

## Problem

- Resolved steps (subspec 00) still need one real invocation dispatched, its ID linked to the stage before it
  settles, and its terminal outcome (success artifact or failure detail) written back — through a seam a
  standalone module can actually call, and a predicate that can actually distinguish a successful completion
  from a same-shaped non-success one.

## Decisions

- Dispatch goes through a callback the daemon constructs at startup and passes into the dispatcher —
  `PipelineWorkflowDispatch = (steps: AnyWorkflowStep[]) => Promise<{ ok: true; entryRunId: string; invocationId: string } | { ok: false; code: string; message: string }>`
  — a thin wrapper the daemon builds around its own `handleWorkflowStart`/`startWorkflowRun` machinery
  (`v2/src/daemon/daemon.ts`). This rules out a standalone module reaching into `handleWorkflowStart` directly:
  it is a closure private to the daemon factory, not an exported function.
- `v2/src/daemon/pipeline-stage-dispatch.ts` takes one resolved stage's steps, this callback, and the
  `StateStore`. On a successful dispatch it writes `startedAt` and `workflowInvocationId` (the returned
  `entryRunId`) via `StateStore.updateStage` before the invocation settles, so a crash mid-stage leaves a
  resolvable linkage. A dispatch refusal (`ok: false` — claimed worktree, insufficient memory, materialization
  failure, routing-read failure, invalid params) records `endedAt`, `status: "failed"`, and `failureDetail`
  immediately, with no retry or queueing (deferred).
- Terminal success is the daemon's own completion rollup (`rollupWorkflowRunStatus`, the same predicate backing
  the `workflow.wait`/`list` RPC handlers) reading `completed` for the dispatched entry run. `failed`, `blocked`,
  and `killed` are terminal non-success; any other rollup status means the stage has not yet settled.
- The dispatcher awaits settlement through the daemon's own wait primitive for that entry run (the mechanism
  backing the `wait` RPC handler), not the dispatch callback's returned promise — which resolves at run creation,
  before the workflow's steps have run, not at completion.
- On settlement it writes `endedAt` and either: `status: "succeeded"` plus an artifact reference
  `{ entryRunId, invocationId, specPath }` (`prNumber`/`prUrl` added when present), all read off the entry run
  row with `specPath` worktree-relative per subspec 00; or `status: "failed"` plus a `failureDetail` built from
  the rollup's composed operator error. Never both.
- A killed or otherwise abandoned run that never reaches a rollup-terminal status still resolves through the
  wait primitive's own terminal outcome (`killed`) and is recorded as a stage failure the same way; there is no
  pipeline-level kill in this slice (deferred to a future CLI slice).
- Stage status vocabulary (daemon-owned, not interpreted by the state store): `pending` (admitted, undispatched),
  `running` (dispatched, unsettled), `succeeded`, `failed`, `skipped` (never dispatched because an earlier stage
  failed — written by the progression loop in subspec 02).

## Task checklist

- Add `v2/src/daemon/pipeline-stage-dispatch.ts`.
- Add `v2/src/daemon/pipeline-stage-dispatch.test.ts` with a fake `PipelineWorkflowDispatch` and fake wait
  primitive.
- Update `v2/docs/daemon-host.md` and `v2/docs/state-store.md`.

## Acceptance criteria

- [x] Dispatching a stage records `workflowInvocationId` equal to the fake dispatch callback's returned
      `entryRunId` before the fake wait primitive resolves, proving the pre-settlement linkage write; it fails
      against the pre-change code.
- [x] A stage whose fake wait primitive resolves `completed` records `succeeded`, `endedAt`, and an artifact
      reference containing `entryRunId`, `invocationId`, and the worktree-relative `specPath`, with no artifact
      file content.
- [x] A stage whose fake wait primitive resolves `failed`/`blocked`/`killed` records `failed`, `endedAt`, and a
      failure detail, and no artifact reference; inverting the success/non-success branch turns this test RED.
- [x] A stage whose dispatch callback returns `ok: false` records `failed` and `failureDetail` immediately, with
      no `startedAt`/invocation linkage ever written; inverting this refusal-handling branch turns the test RED.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [x] `v2/docs/daemon-host.md` documents the dispatch seam, the pre-settlement linkage write, the
      terminal-success predicate, the artifact/failure recording, and the full stage status vocabulary;
      `v2/docs/state-store.md` documents the pointer-only artifact envelope shape as a durable-row concern only.

## Documentation updates

- `v2/docs/daemon-host.md` — dispatch seam, pre-settlement linkage, terminal-success predicate,
  artifact/failure recording, stage status vocabulary.
- `v2/docs/state-store.md` — pointer-only artifact envelope shape (durable-row shape only; vocabulary
  interpretation lives in `daemon-host.md`).
- `v2/docs/v1-behaviors.md` — no change; additive v2-only behavior.
