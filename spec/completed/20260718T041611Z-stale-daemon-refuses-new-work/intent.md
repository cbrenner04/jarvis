---
name: stale-daemon-refuses-new-work
---

# A stale daemon refuses new work with restart guidance

Before admitting or resuming daemon-backed work, `jarvis` compares the running daemon's loaded source revision with the invoking CLI revision. A mismatch sends no work request, names both revisions, and directs the operator to restart the daemon; matching revisions continue unchanged.

## Decisions

- Refuse work-admitting and resume requests on mismatch; rules out a warning that stale code may ignore or obscure.
- Keep lifecycle and observation commands available; rules out blocking status, stop, and diagnosis needed for recovery.
- Leave admitted and in-flight runs untouched; rules out reload or termination during active work.
- Compare at client dispatch; rules out stale daemon code deciding whether it is stale.

## Documentation updates

- `v2/docs/write-behavior.md` — stale-daemon preflight and error contract.
- `v2/docs/operator-runbook.md` — replace the restart-after-every-merge stopgap with mismatch recovery.
- `v2/docs/v1-behaviors.md` — v2-only stale-daemon guard.

## Prerequisites

- Daemon lifecycle status exposes the running source snapshot and the invoking CLI can compare it with its own revision.
