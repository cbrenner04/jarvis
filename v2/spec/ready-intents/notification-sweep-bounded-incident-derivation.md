---
name: notification-sweep-bounded-incident-derivation
---

# Bounded operator-incident derivation and non-overlapping notification sweeps

## Prerequisites

- The state store exposes SQL-filtered candidate run and pipeline queries parameterized by status set and `sinceMs`.
- The state store exposes batched run lookup and batched invocation lookup for deduped ID sets in one round-trip each.

## Module-boundary surface

- Daemon

## Problem

Each five-second notification sweep calls `deriveOperatorIncidents`, which recomputes every historical incident synchronously on the daemon event loop. At the operator's current store size this starves IPC for tens of seconds per tick; overlapping timer callbacks stack further sweeps and present as a bound-but-unresponsive daemon whose `daemon status` probe times out.

## Decision ledger

- `deriveOperatorIncidents` reads only bounded candidate runs and pipelines from the new store queries; rules out enumerating all terminal history every sweep.
- Terminal candidate bound is `nowMs - ATTENTION_TERMINAL_RECENCY_MS` (12h, shared with TUI attention recency); run query always includes non-terminal rows and terminal rows with `finished_at >= sinceMs`; pipeline query always includes non-terminal pipelines and terminal pipelines whose latest stage `ended_at`/`decided_at` or `terminal_publication_succeeded_at` is `>= sinceMs`; rules out an unbounded or notification-only retention constant.
- Stage-attributed and deferred-settlement resolution share one batched run lookup and one batched invocation lookup per sweep; rules out per-stage `loadRun` and per-stage `findRunsByInvocationId` in `collectPipelineAttributedRunIds`.
- Delivery-ledger rows suppress incident re-derivation, not only re-delivery; rules out paying full derivation cost for already-recorded `(incidentId, transition)` pairs.
- A sweep still running when the five-second timer fires skips the tick; rules out queueing overlapping sweeps on the event loop.
- Sweep store work is independent of total history size when the actionable set is identical; rules out cost growing monotonically with retained rows.

## Acceptance criteria

- [ ] The new `operator-notification.test.ts` test `deriveOperatorIncidents excludes terminal runs outside the recency bound` seeds many old terminal runs plus a small actionable set and asserts derived incidents contain only actionable rows; it fails against the pre-fix full-history derivation.
- [ ] The new `operator-notification.test.ts` test `deriveOperatorIncidents store work is unchanged when old terminal history is padded` asserts store-query count or rows decoded is identical between a small store and one padded with old terminal rows whose actionable set is identical; it fails against the pre-fix unbounded enumeration.
- [ ] The new `operator-notification.test.ts` test `delivery ledger suppresses incident re-derivation on later sweeps` records a delivery-ledger row then asserts a later sweep does not re-derive that incident; it fails against the pre-fix derive-then-ledger-diff path.
- [ ] The new `operator-notification-sweep.test.ts` test `notification sweep timer skips a tick while the prior sweep is still running` drives the daemon `setInterval` guard (not concurrent `runNotificationSweep` calls alone) and asserts the second tick is skipped, not queued; it fails against the pre-fix overlap behavior.
- [ ] The new `operator-notification.test.ts` test `stage-attributed resolution uses one batched run lookup and one batched invocation lookup per sweep` counts store calls and asserts resolution issues one batched run lookup and one batched invocation lookup per sweep rather than per-stage `loadRun` or `findRunsByInvocationId`; it fails against the pre-fix N+1 resolution.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — § Operator notifications: bounded candidate set, delivery-ledger derivation skip, and no-overlap sweep guarantee.
- `v2/docs/operator-runbook.md` — § Daemon lifecycle: notification-sweep event-loop starvation can present as a daemon that binds its socket but never answers reads as `stopped`; retrying `daemon start` stacks CPU spinners; distinguishing checks from superseded-daemon and `daemon stop`/`run kill` deadlock shapes.
- `v2/docs/v1-behaviors.md` — notification sweep derives incidents from a bounded actionable set only.
