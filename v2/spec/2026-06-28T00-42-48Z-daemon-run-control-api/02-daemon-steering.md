# 02 — Daemon pause / resume / kill steering

The full steering vocabulary over the runs tracked in subspec 01. `pause` drives
the graceful-stop input from subspec 00; `kill` aborts the daemon-owned signal
and tears down the agent process group; `resume` re-invokes the loop, whose
existing resume path branches on how the step stopped. No richer steering
(edit-spec / inject / reorder) — that is Phase 6.

## Decisions

- `pause` triggers the loop's graceful-pause input (subspec 00), leaving the run
  durably `paused` at the next boundary — rules out mapping pause to abort.
- `kill` aborts the run's daemon-owned `AbortSignal` immediately; the
  abort-honoring binding tears down the agent process group SIGTERM→SIGKILL (v1
  abort) — rules out a graceful kill or a clean-tree guarantee. A dirty worktree
  is expected.
- The daemon records run status `killed` because it initiated the kill (the
  loop, aborted mid-step, cannot record it); the loop records `paused` itself —
  rules out a single owner trying to record both transitions.
- Write-after-abort ownership: if the loop observes its `signal` aborted when the
  in-flight step returns, it skips the boundary commit and the daemon remains the
  sole writer of `killed` — rules out the loop racing a boundary commit (or a
  status write) against the daemon's `killed` write after a kill.
- `pause`/`kill`/`resume` reject an unknown run ID; `resume` also rejects a run
  in a terminal status (`completed`/`failed`/`blocked`) — rules out steering a
  run that does not exist or re-invoking the loop on already-finished work.
- Add `killed` to the `RunStatus` union (both `state-store.ts` and
  `state-store-types.ts`) — its first consumer is this verb.
- `resume` re-invokes `executeWriteLoop` for the run and relies on its durable
  resume branch: `paused` → continue with a fresh attempt; `killed`/crashed
  (last attempt `in-progress`) → re-run the interrupted step over the dirty
  worktree — rules out the daemon re-deciding the branch instead of reading
  durable state.
- `resume` re-registers the run under the same admission guards as `start` (one
  per `(project,branch)`, single in-flight) — rules out resume bypassing the
  guards and creating an overlapping live loop.
- In-process tests may use working method names chosen by the implementer for
  `pause`/`kill`/`resume`; stable external names are deferred to the CLI subspec
  as first external caller.

## Task checklist

- Add `killed` to `RunStatus` in `state-store.ts` and `state-store-types.ts`.
- Wire a per-run graceful-pause input (subspec 00) into the daemon run registry
  alongside the abort controller.
- `pause` handler: signal graceful stop for the run.
- `kill` handler: abort the run's signal, record run status `killed`.
- `resume` handler: load the durable run row by ID to reconstruct the
  `WriteLoopInput` (project, branch, worktree, spec path), then re-invoke
  `executeWriteLoop` under the start guards; the loop's resume branch selects
  continue vs re-run.
- Reject `pause`/`kill`/`resume` on an unknown run ID, and `resume` on a terminal
  run (`completed`/`failed`/`blocked`).
- Co-locate tests over in-process IPC with simulated bindings, including a
  binding that observes abort for the kill path.

## Acceptance criteria

- [ ] `pause` stops the run at the next boundary with durable status `paused`; the in-flight step is allowed to finish (not aborted).
- [ ] `kill` aborts the run's signal immediately and leaves durable status `killed`; the worktree is left dirty (last attempt remains uncommitted).
- [ ] An abort-honoring binding observes the abort when a run is killed.
- [ ] `resume` of a `paused` run continues with a fresh attempt; `resume` of a `killed` run re-runs the interrupted step over the dirty worktree.
- [ ] `resume` is rejected if it would violate the single-in-flight or per-`(project,branch)` guard.
- [ ] If a step returns after its run was killed (signal aborted), the loop skips the boundary commit and the daemon is the sole writer of `killed`.
- [ ] `pause`, `kill`, and `resume` each reject an unknown run ID.
- [ ] `resume` of a terminal run (`completed`/`failed`/`blocked`) is rejected.
- [ ] `RunStatus` includes `killed` in both `state-store.ts` and `state-store-types.ts`.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/v2-architecture.md` — Steering semantics + Runs/state: reconcile
  pause/kill/resume and add `killed` to the run status vocabulary.
- `v2/docs/daemon-host.md` — add `pause` / `resume` / `kill` to the RPC methods
  table.
