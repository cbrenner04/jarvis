# 01 — Daemon start-run + list-runs

The daemon gains its first orchestration verbs over the unchanged core. Today
`startDaemon` (`v2/src/daemon.ts`) serves only `health`/`status`/`shutdown` and
holds a `WorktreeOwnershipRegistry`. Add `start` (spawn `executeWriteLoop` in the
background with a daemon-owned `AbortController`, return a run ID) and `list`
(durable rows merged with in-memory liveness), with the admission guards. No
steering and no tail here (subspecs 02, 03).

## Decisions

- `start` runs `executeWriteLoop` in the background (not awaited in the RPC
  handler) and returns the run ID immediately — rules out a blocking start that
  would hold the IPC request open for the whole run.
- The daemon owns one `AbortController` per active run, stored in an in-memory
  run registry alongside the existing worktree ownership — rules out the core
  owning cancellation (it must stay daemon-unaware).
- One active run per `(project, branch)` is enforced at `start` via the existing
  registry key; a second `start` on the same key is rejected, not queued — rules
  out overlapping runs on one branch.
- At most one in-flight run globally in this phase; `start` is rejected while any
  run is active — rules out a queue / admission control / `queued` status
  (Phase 7).
- `list` merges durable `runs` rows with in-memory liveness so a row shows
  whether its loop is actually executing now — rules out reporting durable status
  alone, which cannot distinguish a live run from a crashed daemon's stale row.
- Add a `listRuns()` read to the state store (no generic SQL surface) — its first
  consumer is this verb.
- A run is "settled" once the loop's Promise has resolved, regardless of outcome
  kind (including `paused`, which resolves the Promise without being terminal) —
  rules out conflating settled (loop no longer executing) with terminal run
  status.
- The in-memory run registry type is open to extension in subspec 02 (which adds
  a per-run pause mechanism) — rules out defining it as a sealed/final shape that
  02 cannot extend.
- In-process IPC tests may use working method names chosen by the implementer;
  stable external names are deferred to the CLI subspec as first external caller
  — rules out pinning external wire names before that caller exists.

## Task checklist

- Add `listRuns()` to the state store returning durable run rows.
- Add an in-memory run registry on the daemon tracking `{ runId, key,
  abortController }` for active runs.
- `start` handler: validate the per-`(project,branch)` guard and the single
  in-flight guard, spawn `executeWriteLoop` in the background with a daemon-owned
  abort signal, register the run, return its run ID; release registration when
  the loop settles.
- `list` handler: merge `listRuns()` with the live run registry into per-run
  status + liveness.
- Co-locate tests exercising start/list over in-process IPC with simulated
  bindings.

## Acceptance criteria

- [ ] `start` returns a run ID and the loop runs in the background (the RPC response does not wait for loop completion).
- [ ] A second `start` for the same `(project, branch)` while the first is active is rejected.
- [ ] A `start` issued while any run is active is rejected (single in-flight run; no queue).
- [ ] `list` returns durable run rows merged with in-memory liveness, marking which runs are currently executing.
- [ ] A run that has settled (its loop Promise resolved, any outcome kind) is no longer reported as live by `list`.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — add `start` / `list` to the RPC methods table with
  their `params`/`result` shapes and the two admission guards.
- `v2/docs/v2-architecture.md` — Interface: record the start/list verbs and the
  durable-plus-liveness list semantics.
