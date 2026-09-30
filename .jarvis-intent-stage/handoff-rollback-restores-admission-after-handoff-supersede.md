---
name: handoff-rollback-restores-admission-after-handoff-supersede
---

# Handoff rollback restores admission after the handoff successor superseded the incumbent

## Problem

When a pending handoff's successor calls `supersede` and the handoff then rolls back, `wasSuperseded()` stays true so rollback skips reopening admission even after a successful public rebind; new work gets `daemon_superseded` indefinitely. A fallback rollback that loses the first rebind to `EADDRINUSE` while a live successor still owns the path can race that successor instead of deferring to its verdict.

## Decisions

- Rollback on a pending handoff clears a `supersede` received during that same transaction and reopens admission on successful rebind; an external `supersede` with no pending handoff still keeps the incumbent retiring.
- Fallback rollback that cannot rebind because a live successor holds the public address defers to that successor's commit/rollback outcome rather than rescheduling rollback against it.

## Acceptance criteria

- [ ] A focused `createHandoffHandlers` regression with fakes drives changeover → `supersede` → rollback and asserts `retiring` is false and a subsequent start is admitted; it fails against the pre-fix code.
- [ ] The same harness with `supersede` and no pending handoff asserts rollback-less incumbent stays retiring (existing guard preserved).
- [ ] A focused fallback regression asserts first `bindPublicServer` rejects `EADDRINUSE`, a rescheduled attempt succeeds, admission reopens, and the transaction is `rolled_back`; it fails against the pre-fix code.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — autonomous self-handoff rollback reopens admission even after the handoff successor's `supersede`.
- `v2/docs/operator-runbook.md` — sole-daemon `daemon_superseded` after `Self-handoff failed` when rollback should have restored admission; `jarvis daemon start` as manual fallback.

## Prerequisites
