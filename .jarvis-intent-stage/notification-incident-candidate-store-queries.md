---
name: notification-incident-candidate-store-queries
---

# Bounded store queries for operator-incident candidate rows

## Prerequisites

## Module-boundary surface

- Persistence

## Problem

`deriveOperatorIncidents` reaches the store through unbounded `listRuns()` and `listPipelines()`, decoding every historical JSON row on each five-second sweep. Incident derivation needs SQL-filtered candidate sets and batched run resolution instead of per-row `loadRun` loops.

## Decision ledger

- Candidate run query filters by status set and `sinceMs` in SQL; rules out unbounded `listRuns()` with in-memory filtering.
- Candidate pipeline query filters by derived terminal state and `sinceMs` in SQL; rules out full-history `listPipelines()` materialization for notification work.
- Batched run lookup resolves a deduped ID set in one store round-trip; rules out per-stage `loadRun` calls during stage-attributed resolution.
- Query parameters are caller-supplied bounds; rules out baking notification-specific retention constants into the persistence layer.

## Acceptance criteria

- [ ] A new `state-store.test.ts` test seeds many terminal runs older than `sinceMs` plus a small non-terminal and recently-settled set and asserts the candidate run query returns only the bounded rows; it fails against the pre-fix unbounded `listRuns()` path.
- [ ] A new `state-store.test.ts` test seeds many old terminal pipelines plus a small actionable set and asserts the candidate pipeline query returns only bounded rows; it fails against the pre-fix full `listPipelines()` scan.
- [ ] A new `state-store.test.ts` test asserts batched run lookup returns every requested ID in one call and does not issue one query per ID; it fails against repeated `loadRun`.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- None — query contracts are evident from signatures; operator semantics land in the daemon intent.
