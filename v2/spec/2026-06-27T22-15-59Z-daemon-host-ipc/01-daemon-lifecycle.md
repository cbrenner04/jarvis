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
- `startDaemon` requires injected `socketPath` (and test-only `pidPath` when
  needed); bounded wait for `health`; throws on readiness timeout — rules out
  silent success and an implicit production socket/PID default in this slice.
- Second `startDaemon` while the configured `socketPath` already answers `health`
  fails with a typed error — rules out spawning a second child and idempotent
  double-start (crash/orphan recovery stays deferred).
- `stopDaemon` sends a shutdown signal, rejects new connections, drains in-flight
  IPC, bounded wait then forced exit on hang — rules out `SIGKILL`-only teardown
  and unbounded integration-test hangs.
- `getDaemonStatus` probes process liveness first, then short-timeout `health`;
  any failure → `stopped` — rules out transport-before-liveness ordering and
  PID-only checks.
- Worktree ownership is an in-memory map keyed by `{ project: string, branch:
  string }` (state-store resume key) holding `runId` + worktree path; the daemon
  entrypoint constructs and holds the registry — rules out a freestanding library
  with no host tie-in, on-disk PID-lock coordination, and alternate key shapes.
- `claim` rejects double-claim with a typed error; `release` on an unheld key is
  a no-op — rules out silent overwrite and throw-on-release.
- `.jarvis.lock` / `shared/worktree-lock.ts` / `external-worktree.ts` stay
  unchanged — rules out replacing cross-process coexistence locks with daemon-
  global mutex.
- `executeWriteLoop` and the state store are untouched — rules out run spawn,
  steering, or orchestration columns in this slice.
- Deferred to first consumer: default `socketPath` under `~/.jarvis`, default
  PID-file path, stale-socket recovery, and max concurrent IPC clients cap —
  pin when CLI/TUI connect; tests use injected paths only.

## Task checklist

- [ ] Daemon entrypoint: start IPC listener from 00, construct/hold ownership
  registry, register `health`/`status` handlers, block until shutdown.
- [ ] `startDaemon`: spawn detached child, bounded wait for `health` on injected
  `socketPath`, throw on timeout, return child metadata.
- [ ] `stopDaemon`: shutdown signal, reject new connections, drain in-flight IPC,
  bounded wait, forced exit on hang; clean up injected pid/socket artifacts in
  tests.
- [ ] `getDaemonStatus`: liveness first, then short-timeout `health`; any failure
  → `stopped`.
- [ ] In-memory ownership registry: `claim`, `release`, `get`, `isClaimed` keyed
  by `{ project, branch }`; unit-tested without run spawn.
- [ ] Agent-runnable DI tests for start/stop/status logic; real detached-child
  coverage in `daemon.sandbox-unrunnable.test.ts` (top comment per
  `v2/docs/test-writing.md`).

## Acceptance criteria

- [ ] `startDaemon` leaves a detached process running after the parent exits; the
  child serves `health` on the injected `socketPath`; readiness timeout throws.
- [ ] Second `startDaemon` while `health` succeeds on the configured `socketPath`
  fails with a typed error (no second child).
- [ ] `getDaemonStatus` returns `running` only when the child is alive and
  short-timeout `health` succeeds; any liveness or transport failure → `stopped`.
- [ ] After `stopDaemon`, the socket is unbound, `getDaemonStatus` → `stopped`,
  and the child exits 0.
- [ ] `status` IPC RPC on the live daemon reports `{ state: "running" }`.
- [ ] Daemon entrypoint constructs and holds the in-memory ownership registry
  (IPC exposure not required this slice).
- [ ] `claim({ project, branch, runId, worktreePath })` rejects a second claim
  on the same key with a typed error; `release` on an unheld key is a no-op;
  no disk writes.
- [ ] `write-loop.test.ts` and `shared/worktree-lock.test.ts` stay green
  (behavior unchanged).
- [ ] `external-worktree.sandbox-unrunnable.test.ts` stays green (operator suite;
  not agent-runnable).
- [ ] `daemon.sandbox-unrunnable.test.ts` covers start → `status` running →
  `health`/`status` RPC → stop → `stopped` with injected socket/pid paths.
- [ ] New code lives under `v2/**`/`shared/**` with no `v2 -> v1` imports.
- [ ] `bun run typecheck` (both tsconfigs) and `bun test` pass.

## Documentation updates

- [ ] `v2/docs/daemon-host.md`: lifecycle API (`start`/`stop`/`status` semantics),
  detached-process model, graceful-shutdown baseline, double-start failure,
  `getDaemonStatus` probe order, injected-path policy, and in-memory ownership
  keyed by `{ project, branch }` with cross-link to architecture Git/worktrees
  locking.
- [ ] `v2/docs/v2-architecture.md` Interface section: record hermetic Unix-
  socket IPC and in-memory worktree ownership; reconcile with Git/worktrees
  locking bullet (daemon runs vs `.jarvis.lock` coexistence).
- [ ] `v2/docs/v1-behaviors.md`: no change — additive v2-only surface.
