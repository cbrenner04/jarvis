---
name: emit-invocation-completed-telemetry-for-write-steps
---

# Emit `invocation_completed` telemetry for write steps

## Problem

Phase 5 is the first telemetry runtime consumer, but v2 still emits no
append-only analysis facts. Without per-invocation rows at the shared
invocation seam, later exports and parity work would need v1-style re-keying.

## Direction

Append one `invocation_completed` JSONL row after each write-step agent
subprocess settles, using the shared invocation seam and an injectable
telemetry sink path.

This slice covers write-workflow invocations only.

This slice does not add `work_boundary_recorded`, `run_terminal`, exports, or
review-debate/human coverage.

## Decisions

- First runtime telemetry slice is `invocation_completed` on write steps only — rules out bundling `work_boundary_recorded`, `run_terminal`, or later behaviors into the first consumer.
- Quota fallback emits one `invocation_completed` row per binding attempt/subprocess — rules out one aggregated row for a logical invocation.
- The emitter writes the contract fields from runner-owned IDs and invocation results at settle time — rules out re-parsing observability logs or git state to reconstruct telemetry.
- The sink is append-only JSONL on an injectable path — rules out storing analysis facts in orchestration SQLite or the observability log.
- Unavailable usage/cost fields are emitted as explicit `null` — rules out omitting keys and forcing absent-vs-unavailable inference in consumers.
- Durable docs pin the runtime behavior in `v2/docs/telemetry-capture.md` and the invocation/runner boundary docs — rules out leaving the first-consumer deferral unresolved after code lands.

## Documentation updates

- `v2/docs/telemetry-capture.md` — pin the quota-fallback grain and note write-step runtime coverage now exists.
- `v2/docs/shared-step-runner.md` — point the Phase 5 runner seam at the live `invocation_completed` emitter.
- `v2/docs/shared-invocation.md` — document the shared invocation seam as the `invocation_completed` emission boundary.

## Prerequisites

- Shared invocation execution is centralized in `shared/invocation/execute.ts`.
- The workflow runner owns stable run/attempt/step context for write-step executions.
- `v2/docs/telemetry-capture.md` is the durable capture contract for v2 analysis facts.
