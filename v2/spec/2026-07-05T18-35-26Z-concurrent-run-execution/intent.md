---
name: concurrent-run-execution
---
# Concurrent Run Execution

# Concurrent run execution

The daemon executes multiple admitted runs in parallel rather than serializing
them, so two or more non-queued runs make progress at the same time.

## Prerequisites

- Memory-watermark admission and `queued` status exist

## Blocker

Cannot confirm: memory-watermark admission and `queued` `RunStatus` do not exist yet.

- `RUN_STATUSES` (`v2/src/persistence/state-store-types.ts:4-13`) has no `queued` value.
- No watermark/admission logic in `v2/src` (design-only in `v2/docs/v2-architecture.md:502-539`, `v2/docs/v2-build-order.md:118-121` Phase 7).
- Run execution is currently hard-serialized: `daemon.ts` rejects `start`/`resume` whenever `activeRuns.size > 0` ("at most one in-flight run globally").
- The prerequisite is itself an unbuilt ready-intent: `v2/spec/ready-intents/memory-watermark-admission-and-queued-status.md`.

Build (and merge) memory-watermark admission and `queued` status first, then resubmit this intent.
