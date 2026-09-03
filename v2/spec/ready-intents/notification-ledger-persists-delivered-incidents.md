---
name: notification-ledger-persists-delivered-incidents
---

# Delivery ledger records delivered incident payloads for pull consumers

## Prerequisites

## Module-boundary surface

- Persistence

## Problem

`operator_notification_deliveries` stores only `(incidentId, transition, deliveredAt)`. The sink can fire-and-forget JSON, but a pull consumer cannot catch up, resume from a cursor, or return an incident delivered while no waiter was armed without re-deriving unbounded durable state.

## Decision ledger

- Migration adds nullable `incident_json` on `operator_notification_deliveries`; new deliveries persist the same serialized incident JSON the sink receives on stdin alongside the existing dedupe key; rules out list/wait re-deriving incidents from runs and pipelines.
- Legacy key-only rows keep `incident_json` null and are excluded from delivered-incident list/wait queries; rules out backfill or re-derivation for pre-change ledger rows.
- The store exposes an ordered delivered-incident query parameterized by `since` cursor or timestamp and optional kind set; rules out CLI or daemon reading sqlite ad hoc.
- Consumer cursor is the delivered row identity (`deliveredAt`, `incidentId`, `transition`); wire form is colon-delimited `deliveredAt:incidentId:transition` shared by the store query boundary, daemon RPC params, and CLI `--since`; rules out line-offset, file-position, or opaque blob cursors.
- Deferred to first consumer: exact `--since` duration literal grammar — pin when CLI admission lands.

## Acceptance criteria

- [ ] The new `state-store.test.ts` test `notification delivery persists serialized incident JSON` records a delivery with a full incident payload and asserts the stored row round-trips the sink JSON shape; it fails against the pre-fix key-only ledger.
- [ ] The new `state-store.test.ts` test `list delivered notification incidents honors since cursor` seeds multiple delivered rows and asserts the query returns only rows at or after the cursor in stable order; it fails against the pre-fix absent query API.
- [ ] The new `state-store.test.ts` test `delivered incident is readable after recording with no active consumer` records a delivery then queries with a prior cursor and asserts the incident is returned; it fails against the pre-fix ledger that cannot serve pull catch-up.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` — `operator_notification_deliveries` schema (`incident_json` column, legacy null exclusion), delivered-incident query, and cursor wire form.
- `v2/docs/daemon-host.md` — § Operator notifications: delivery-ledger pull contract (persisted incident JSON, cursor semantics, shared by sink discharge and pull consumers).
