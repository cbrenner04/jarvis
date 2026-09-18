# 01 — Failed republication rewrites the marker to `failed`

## Problem

A completed invocation can be republished later through the finalization-only resume tail (`resumeFinalizationOnly`, `v2/src/daemon/daemon-run-lifecycle-handlers.ts`). If that tail fails, the marker from 00 still reads `completed`.

## Decisions

- Resolve the entry run id from the row `resumeFinalizationOnly` receives: read `run.workflowSnapshot?.invocationId`, then take `store.findRunsByInvocationId(invocationId)[0]?.id` — the invocation's first row by creation order is always its entry run (the same order admission relies on when it binds `entryRunId` to the first `stepIndex === 0` report). Skip the rewrite when `run.workflowSnapshot` is undefined or no row resolves.
- Rewrite the marker to `failed` only on a genuine (non-aborted) failure of the tail: `execute()` resolves `{ ok: false }` — whether returned as `{ kind: "error" }` or, when `failureAsResponse` is set, as `{ kind: "response", result: outcome }` — or `execute()` throws past the `try`, in both cases only when `abortController.signal.aborted` is `false` at that point. A successful republication leaves the marker untouched (rewriting on success would re-stamp `settledAt` with no cause change).
- An aborted tail (`run kill`, or a fired run timeout — both abort the same controller) is not a failed republication: leave the marker as-is. This matches 00 — an abort is `killed`/pre-existing state, not this subspec's `failed` rewrite.
- Rewrite only when a marker already exists for that entry run. This covers two no-marker cases the same way: an invocation settled before the marker existed (no re-notification on upgrade), and an invocation orphaned by a daemon crash before its workflow `finally` ran (00's crash gap) — daemon-start recovery never wrote one either, so the entry-run guard here makes a later republication rewrite a no-op instead of fabricating a cause.

## Acceptance criteria

- [ ] A new test drives a completed workflow settlement (marker `completed`) followed by a failing republication through `resumeFinalizationOnly` — thrown-error path — and asserts the marker is rewritten to `failed`; it fails against the pre-fix code.
- [ ] A test drives the same setup through the `failureAsResponse: true` path (`{ ok: false }` returned as a response, not thrown) and asserts the marker is still rewritten to `failed`; it fails against the pre-fix code.
- [ ] A test drives a completed workflow settlement, then aborts the republication tail via `run kill` (or a fired run timeout) mid-flight, and asserts the marker stays `completed` — ruling out an implementation that rewrites to `failed` on any tail rejection regardless of abort state.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md`: a failed republication rewrites the settled marker to `failed`, unless the tail was aborted (kill or run timeout) or no marker exists yet for that entry run.
- `v2/docs/v1-behaviors.md`: republication through `resumeFinalizationOnly` now has a side effect on the settled marker — record the new behavior (rewrite to `failed` on genuine, non-aborted failure).
