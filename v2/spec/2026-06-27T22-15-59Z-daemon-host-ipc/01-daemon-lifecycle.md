# 01 — Daemon lifecycle and worktree ownership

Detached long-running daemon host: programmatic `start` / `stop` / `status`,
graceful shutdown, and an in-memory worktree-ownership registry (structure only —
no `executeWriteLoop` spawn). Wires the IPC transport from 00.

## Decisions

- Daemon is a detached child process with its own entrypoint under `v2/src` —
  rules out in-process-only hosting and teaching `executeWriteLoop` about the
  daemon.
- Lifecycle is a programmatic API (`startDaemon`, `stopDaemon`, `getDaemonStatus`)
  callable from tests — rules out adding CLI control commands here (sibling
  intent).
- `startDaemon` returns after the child binds the IPC socket and responds to
  `health` — rules out returning before the transport is ready.
- `stopDaemon` requests graceful shutdown (in-flight IPC completes, listener
  closes, process exits 0) — rules out `SIGKILL`-only teardown as the only path.
- `getDaemonStatus` reports `running` when the child is alive and `health`
  succeeds, else `stopped` — rules out PID-only checks with no transport probe.
- Worktree ownership is an in-memory map keyed by `(project, branch)` holding
  `runId` + worktree path; `claim` rejects double-claim, `release` is idempotent
  — rules out on-disk PID-lock coordination among daemon runs and persisting
  ownership rows.
- `.jarvis.lock` / `shared/worktree-lock.ts` / `external-worktree.ts` stay
  unchanged — rules out replacing cross-process coexistence locks with daemon-
  global mutex.
- `executeWriteLoop` and the state store are untouched — rules out run spawn,
  steering, or orchestration columns in this slice.
- Deferred to first consumer: default socket filename, stale-socket recovery, max
  concurrent IPC clients, and default PID-file path — pin when CLI/TUI connect;
  tests use injected paths.

## Task checklist

- [ ] Daemon entrypoint: start IPC listener from 00, register `health`/`status`
  handlers, block until shutdown.
- [ ] `startDaemon`: spawn detached child, wait for `health` on the configured
  socket path, return child metadata to caller.
- [ ] `stopDaemon`: signal graceful shutdown, await child exit, clean up injected
  pid/socket artifacts in tests.
- [ ] `getDaemonStatus`: combine process liveness with `health` RPC result.
- [ ] In-memory ownership registry module: `claim`, `release`, `get`,
  `isClaimed` keyed by `(project, branch)`; unit-tested without run spawn.
- [ ] Co-located integration test: start → `status` running → `health`/`status`
  RPC → stop → `status` stopped; temp socket/pid paths only.

## Acceptance criteria

- [ ] `startDaemon` leaves a detached process running after the parent exits; the
  child serves `health` on the configured socket path.
- [ ] `getDaemonStatus` returns `running` while the child is up and `health`
  succeeds; after `stopDaemon` it returns `stopped`.
- [ ] `stopDaemon` exits the child cleanly (exit 0) without orphaning the socket
  listener beyond the configured recovery deferral.
- [ ] `status` IPC RPC on the live daemon reports `{ state: "running" }`.
- [ ] Ownership `claim(project, branch, runId, worktreePath)` rejects a second
  claim on the same key while held; `release` clears it; no disk writes.
- [ ] `executeWriteLoop` and `external-worktree` / `shared/worktree-lock` behavior
  are unchanged (`write-loop.test.ts`, `shared/worktree-lock.test.ts`, and
  `external-worktree.sandbox-unrunnable.test.ts` stay green).
- [ ] New code lives under `v2/**`/`shared/**` with no `v2 -> v1` imports.
- [ ] `bun run typecheck` (both tsconfigs) and `bun test` pass.

## Documentation updates

- [ ] `v2/docs/daemon-host.md`: add lifecycle API (`start`/`stop`/`status`
  semantics), detached-process model, graceful shutdown, and in-memory ownership
  keyed by `(project, branch)` with cross-link to architecture Git/worktrees
  locking.
- [ ] `v2/docs/v2-architecture.md` Interface section: record hermetic Unix-
  socket IPC and in-memory worktree ownership; reconcile with Git/worktrees
  locking bullet (daemon runs vs `.jarvis.lock` coexistence).
- [ ] `v2/docs/v1-behaviors.md`: no change — additive v2-only surface.
