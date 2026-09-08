---
name: persist-operator-failure-records
---

# Persist operator failure records

## Prerequisites

## Module-boundary surface

- Persistence: the shared failure contract and durable run/pipeline storage.

## Problem

Run failures are reconstructed from partial row and log state, while pipeline stages accept arbitrary `failureDetail`; neither durable seam guarantees the evidence an operator needs.

## Behavior

- One typed operator failure record round-trips on durable run rows and terminal pipeline-stage `failureDetail`, preserving expectation, observation, optional near miss, reissue retryability, and path origin.

## Decision ledger

- Place the cross-library record type in the shared layer; rules out persistence value-importing execution code or maintaining separate run and pipeline contracts.
- Persist the record itself on run rows and use the same type for terminal pipeline-stage failure detail; rules out reconstructing operator evidence from lossy status and log fields.
- Treat legacy rows without the record as absent evidence; rules out migrations inventing expectations or observations that were never recorded.
- Mark referenced paths as harness-internal or operator-repository data in the record; rules out renderers guessing ownership from path text.

## Acceptance criteria

- [ ] `v2/src/persistence/state-store.test.ts` proves a failure record round-trips on a run row with expectation, observation, near miss, retryability, and both path origins; it fails against the pre-fix run schema.
- [ ] `v2/src/persistence/state-store.test.ts` proves the same record round-trips as terminal pipeline-stage `failureDetail` without field loss; it fails against the pre-fix untyped contract.
- [ ] `v2/src/persistence/state-store-baseline-migration.test.ts` proves legacy rows load with absent failure evidence and current rows retain it across reopen.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` — shared failure-record fields, run/stage ownership, legacy absence, and path-origin contract.
- `v2/docs/v1-behaviors.md` — record the v2 durable failure-evidence addition.
