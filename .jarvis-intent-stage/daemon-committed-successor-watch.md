---
name: daemon-committed-successor-watch
---

# Outgoing generation rebinds the public address when its committed successor dies

Seed: `v2/spec/seeds/daemon-survives-committed-successor-death.md`. After self-handoff `commit`, `rollback` is a no-op (`v2/src/daemon/daemon.ts:917-948`) and `startDaemon` stops watching the successor (`v2/src/daemon/daemon-lifecycle.ts:376-395`); a dead committed successor leaves `~/.jarvis/daemon.sock` unbound while the outgoing generation still runs work.

## Decisions

- A retiring outgoing generation keeps watching its committed successor; if the successor's process dies or the public address stops answering, it rebinds the public address and reopens admission.
- The handoff is treated as failed; no re-attempt until the next digest sample.
- The rebind writes a daemon-log line naming its trigger.

## Acceptance criteria

- [ ] A daemon test commits a handoff, kills the successor, and asserts the public address answers again from the outgoing generation within a bounded time; it fails against the current code.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — post-commit successor watch.
- `v2/docs/operator-runbook.md` § Daemon lifecycle — what the operator sees when a successor dies; `daemon start` no longer required.

## Prerequisites

- Every daemon retire/drain/exit path logs its trigger (RPC name and caller, or signal) before acting.
