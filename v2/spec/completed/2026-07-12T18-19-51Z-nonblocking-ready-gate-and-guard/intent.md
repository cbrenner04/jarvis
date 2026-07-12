---
name: nonblocking-ready-gate-and-guard
---
# Keep the ready gate nonblocking and enforce the daemon invariant

Run `bun run ready` and the retried draft-to-ready command asynchronously. Prove `list` and `tail` answer within a deterministic bound while the gate is held open, then add a lint guard that rejects synchronous child-process calls on daemon-reachable v2 and shared code while explicitly excluding tests and allowlisted CLI-only modules. Deliberate small synchronous filesystem reads may remain only through explicit, narrow exceptions.

## Prerequisites

- Daemon admission and worktree Git subprocesses yield to unrelated IPC.
- Daemon-hosted run Git subprocesses yield to unrelated IPC.
- Completion publication subprocesses yield to unrelated IPC.

## Decisions

- Enforce the invariant in lint; rules out test-only or review-only regression detection — new synchronous subprocess imports must fail the normal gate.
- Scope exceptions to tests and named CLI-only modules; rules out a broad directory exclusion that can hide daemon-reachable code.
- Allow only explicit small synchronous filesystem reads; rules out either banning all filesystem sync calls or silently permitting new blocking I/O.
- Keep gate completion and draft-to-ready ordering awaited; rules out background finalization that reports completion early.

## Out of scope

- Moving runs to workers.
- Cancelling an in-flight gate.

## Documentation updates

- Update `v2/docs/daemon-host.md` with the daemon-never-blocks invariant and guard.
- Update `v2/docs/coding-standards.md` with the synchronous subprocess prohibition and exception policy.
