# Batched stage-attributed resolution

## Problem

`collectPipelineAttributedRunIds` and `addSuppressedInvocationForFailedStage` issue per-stage `loadRun` and `findRunsByInvocationId` calls, so stage-attributed and deferred-settlement resolution scales N+1 with pipeline stage count on every sweep.

## Decision ledger

- Stage-attributed and deferred-settlement resolution collect deduped entry-run and invocation IDs across the bounded candidate pipeline set, then resolve each set with one `loadRunsByIds` and one `findRunsByInvocationIds` per sweep; rules out per-stage `loadRun` and per-stage `findRunsByInvocationId` in `collectPipelineAttributedRunIds`.
- Batched lookups run after candidate pipelines are loaded, reusing IDs gathered during the same sweep pass; rules out a second full pipeline scan for attribution.
- Suppressed-invocation collection for failed terminal stages uses the batched run map instead of per-stage `loadRun`; rules out mixed batched and per-row lookup in one sweep.

## Prerequisites

- Subspec 00: `deriveOperatorIncidents` reads bounded candidate pipelines.

## Task checklist

- Refactor `collectPipelineAttributedRunIds` to gather deduped entry-run IDs and invocation IDs from the in-memory candidate pipeline list, then call `loadRunsByIds` once and `findRunsByInvocationIds` once.
- Update `addSuppressedInvocationForFailedStage` (or its call sites) to read entry runs from the batched map instead of `store.loadRun`.
- Add `operator-notification.test.ts` regression `stage-attributed resolution uses one batched run lookup and one batched invocation lookup per sweep`: wrap or spy the store; assert exactly one `loadRunsByIds` and one `findRunsByInvocationIds` per `deriveOperatorIncidents` call regardless of stage count; fails against pre-fix N+1 resolution.

## Acceptance criteria

- [ ] `v2/src/daemon/operator-notification.test.ts` test `stage-attributed resolution uses one batched run lookup and one batched invocation lookup per sweep` counts store calls and asserts resolution issues one batched run lookup and one batched invocation lookup per sweep rather than per-stage `loadRun` or `findRunsByInvocationId`; it fails against the pre-fix N+1 resolution.
- [ ] `v2/src/daemon/operator-notification.test.ts` — `a single failed stage produces one incident across stage, entry-run, and step-run rows` stays green (batched attribution preserves suppression semantics).
- [ ] `bun run test:v2` passes.

## Documentation updates

- Deferred to subspec 04.
