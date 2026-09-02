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
- Batched run lookup resolves a deduped run-ID set in one store round-trip; rules out per-ID `loadRun` during stage-attributed resolution.
- Batched invocation lookup resolves a deduped invocation-ID set in one store round-trip; rules out per-stage `findRunsByInvocationId` during stage-attributed resolution.
- Query parameters are caller-supplied bounds; rules out baking notification-specific retention constants into the persistence layer.

## Acceptance criteria

- [ ] The new `state-store.test.ts` test `listIncidentCandidateRuns excludes terminal runs finished before sinceMs` seeds many terminal runs older than `sinceMs` plus a small non-terminal and recently-settled set and asserts only bounded rows are returned; it fails against the pre-fix unbounded `listRuns()` path.
- [ ] The new `state-store.test.ts` test `listIncidentCandidatePipelines excludes terminal pipelines settled before sinceMs` seeds many old terminal pipelines plus a small actionable set and asserts only bounded rows are returned; it fails against the pre-fix full `listPipelines()` scan.
- [ ] The new `state-store.test.ts` test `loadRunsByIds fetches all requested runs in one round trip` asserts every requested ID is returned and store access is not one query per ID; it fails against repeated `loadRun`.
- [ ] The new `state-store.test.ts` test `findRunsByInvocationIds fetches all invocation siblings in one round trip` asserts every requested invocation ID is resolved and store access is not one query per invocation; it fails against repeated `findRunsByInvocationId`.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- None — query contracts are evident from signatures; operator semantics land in the daemon intent.
