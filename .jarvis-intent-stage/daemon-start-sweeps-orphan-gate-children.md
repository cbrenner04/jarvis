---
name: daemon-start-sweeps-orphan-gate-children
---

# Daemon start sweeps orphaned ready-gate test process groups

## Prerequisites

- The shared async subprocess runner can signal a recorded process group.
- The ready gate records its in-flight test process group id durably against the owning run and clears it on settlement.

## Behavior

Daemon start, before IPC is exposed and alongside the existing orphaned-run marking, reads the durable ready-gate group records, and for each group whose owning run is not live signals the group (SIGTERM then SIGKILL) and clears the record. This recovers leaks that predate the reaping path — including groups left by a daemon that died without settling its runs — rather than relying on clean termination alone.

A record whose owning run is still live is left alone. A group id that no longer exists on the host is treated as already reaped: the record is cleared and startup does not fail.

## Acceptance criteria

- [ ] A seeded orphan record with no live owning run is signaled at daemon start and its record cleared, pinned by a test.
- [ ] A record owned by a live run is not signaled at daemon start, pinned by a test.
- [ ] An already-dead group id clears its record without failing startup, pinned by a test.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — the startup orphan sweep for ready-gate test descendants.
- `v2/docs/operator-runbook.md` — daemon start reaps orphaned gate test groups no live run owns.
