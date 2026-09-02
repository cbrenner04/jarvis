---
name: notification-sweep-bounded-incident-derivation
---

# Bounded operator-incident derivation and non-overlapping notification sweeps

## Prerequisites

- The state store exposes SQL-filtered candidate run and pipeline queries parameterized by status set and `sinceMs`.
- The state store exposes batched run lookup for a deduped ID set in one round-trip.

## Module-boundary surface

- Daemon

## Problem

Each five-second notification sweep calls `deriveOperatorIncidents`, which recomputes every historical incident synchronously on the daemon event loop. At the operator's current store size this starves IPC for tens of seconds per tick; overlapping timer callbacks stack further sweeps and present as a bound-but-unresponsive daemon whose `daemon status` probe times out.

## Decision ledger

- `deriveOperatorIncidents` reads only bounded candidate runs and pipelines from the new store queries; rules out enumerating all terminal history every sweep.
- Deferred to first consumer: actionable `sinceMs` cutoff for terminal rows — pin when derivation lands.
- Stage-attributed and deferred-settlement resolution share one batched lookup per sweep; rules out separate `collectPipelineAttributedRunIds` and per-stage `loadRun` passes.
- Delivery-ledger rows suppress incident re-derivation, not only re-delivery; rules out paying full derivation cost for already-recorded `(incidentId, transition)` pairs.
- A sweep still running when the five-second timer fires skips the tick; rules out queueing overlapping sweeps on the event loop.
- Sweep store work is independent of total history size when the actionable set is identical; rules out cost growing monotonically with retained rows.

## Acceptance criteria

- [ ] A new `operator-incidents` test seeds many old terminal runs plus a small actionable set and asserts derived incidents contain only actionable rows; it fails against the pre-fix full-history derivation.
- [ ] A new test asserts store-query count or rows decoded is unchanged between a small store and one padded with old terminal rows whose actionable set is identical; it fails against the pre-fix unbounded enumeration.
- [ ] A new test records a delivery-ledger row then asserts a later sweep does not re-derive that incident; it fails against the pre-fix derive-then-ledger-diff path.
- [ ] A new test fires a sweep tick while a prior sweep is still in progress and asserts the second tick is skipped, not queued; it fails against the pre-fix `setInterval` overlap behavior.
- [ ] A new test counts store calls and asserts stage-attributed run resolution issues one batched lookup per sweep rather than per-stage `loadRun` calls; it fails against the pre-fix N+1 resolution.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — § Operator notifications: bounded candidate set, delivery-ledger derivation skip, and no-overlap sweep guarantee.
- `v2/docs/operator-runbook.md` — § Daemon lifecycle: a daemon that binds its socket but never answers reads as `stopped`; retrying `daemon start` stacks CPU spinners; distinguishing checks from superseded-daemon and `daemon stop`/`run kill` deadlock shapes.
- `v2/docs/v1-behaviors.md` — notification sweep derives incidents from a bounded actionable set only.
