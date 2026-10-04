---
name: daemon-host-ipc
---

# Daemon process and hermetic IPC transport

Long-running second host: lifecycle (`start` / `stop` / `status`) and a typed request/response + streaming IPC channel. Hermetic — local Unix socket under `~/.jarvis`, no external broker, no network port. Proves the embedding transport; run orchestration lands in a sibling intent.

Source: Phase 3 scope (2) in `v2/spec/seeds/phase-3-daemon-host.md`; Interface + Git/worktrees locking in `v2/docs/v2-architecture.md`. Done condition is merged code in `v2/src`, not this intent.

## What exists today

- `main()` (`v2/src/cli.ts`) is the in-process CLI host; no detached daemon.
- `.jarvis.lock` on worktrees handles cross-process coexistence with `jarvis1`/editors.

## Scope

- Daemon process: start, graceful stop, status (running/stopped + minimal health).
- Typed IPC: request/response framing plus a streaming channel slot for later log/run payloads.
- Unix domain socket under `~/.jarvis` (exact path settled in refine).
- Daemon tracks worktree ownership **in-memory** for its own runs (structure only; run spawn is sibling intent).
- On-disk `.jarvis.lock` unchanged — cross-process coexistence only, not daemon-run coordination among daemon runs.
- Prove transport with at least a health/status RPC; no `executeWriteLoop` spawn here.

## Out of scope

- Starting/listing/steering runs (sibling intent).
- Structured log tail over IPC (needs log stream + run control).
- CLI control commands (sibling intent).
- Concurrency, admission, `queued` status, TUI, workflow runner.

## Decisions

- Transport is local Unix socket under `~/.jarvis` — rules out network port, message broker, or DB-as-bus.
- IPC is typed request/response plus streaming channel — rules out unstructured stdin/stdout pipe protocol.
- Daemon is sole orchestrator for its runs; worktree ownership is in-memory — rules out PID-lock dance among daemon runs.
- `.jarvis.lock` stays for `jarvis1`/editor coexistence — rules out replacing lock with daemon-global mutex.
- Core library (`executeWriteLoop`) unchanged — rules out teaching the loop about daemon existence.
- Deferred to first consumer: socket path filename, stale-socket recovery, and max concurrent IPC clients — pin when CLI/TUI connect.

## Documentation updates

- `v2/docs/v2-architecture.md` — Interface section: record hermetic Unix-socket IPC and in-memory worktree ownership (reconcile with Git/worktrees locking if settled here).

## Prerequisites
