---
name: pipeline-durable-execution-records
---

# Durable pipeline and stage execution records

Slice 2a of [per-project pipelines](../per-project-pipelines-brief.md).

## Prerequisites

- Source-owned pipeline definitions expose stable ordered stage IDs and pass admission validation
- The v2 state store persists and reopens durable orchestration records

## Problem

Workflow run rows cannot represent a pipeline before dispatch or a stage that never dispatches.
Pipeline admission needs its own durable lifecycle records before daemon execution can rely on them.

## Decisions

- Admission atomically persists one pipeline row and one ordered row per defined stage; rules out partial admission and reconstruction from workflow run rows.
- Each stage row carries its stable definition ID, workflow invocation ID, status, start/end timestamps, artifact, and failure detail; rules out a lossy progress-only record.
- Pipeline and stage rows live in the existing SQLite state store; rules out a second database or in-memory registry.
- Stage records are updated in place under their pipeline identity; rules out replacing rows and changing durable stage identity across transitions.
- Deferred to first consumer: artifact representation — pin when daemon execution records workflow output.
- Deferred to first consumer: failure-detail representation — pin when daemon execution maps workflow failure.

## Acceptance criteria

- [ ] Admitting a validated definition creates one durable pipeline row and one stage row per definition stage in authored order.
- [ ] A stage row reads back its stable stage ID, nullable workflow invocation ID, status, start/end timestamps, nullable artifact, and nullable failure detail.
- [ ] Updating one stage lifecycle preserves its identity and the other stage rows.
- [ ] A regression case in `v2/src/persistence/state-store.test.ts` closes and reopens the store, proves the pipeline, stage order, and populated stage fields survive, fails before this change, and passes after it.

## Documentation updates

- `v2/docs/state-store.md` — pipeline and stage tables, fields, ordering, and repository operations.
