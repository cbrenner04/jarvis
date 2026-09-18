# 01 — Failed republication rewrites the marker to `failed`

## Problem

A completed invocation can be republished later through the finalization-only resume tail (`resumeFinalizationOnly`, `v2/src/daemon/daemon-run-lifecycle-handlers.ts`). If that tail fails, the marker from 00 still reads `completed`.

## Decisions

- Resolve the entry run id from the row `resumeFinalizationOnly` receives: read `run.workflowSnapshot?.invocationId`, then take the row from `store.findRunsByInvocationId(invocationId)` whose `stepIndex === 0` — not `[0]` by `created_at`, which can tie. Skip the rewrite when `run.workflowSnapshot` is undefined or no row resolves.
- Rewrite the marker to `failed` only on a genuine (non-aborted) failure of the tail: `execute()` resolves `{ ok: false }` — whether returned as `{ kind: "error" }` or, when `failureAsResponse` is set, as `{ kind: "response", result: outcome }` — or `execute()` throws past the `try`, in both cases only when `abortController.signal.aborted` is `false` at that point. A successful republication leaves the marker untouched (rewriting on success would re-stamp `settledAt` with no cause change).
- An aborted tail (`run kill`, or a fired run timeout — both abort the same controller) is not a failed republication: leave the marker as-is. This matches 00 — an abort is `killed`/pre-existing state, not this subspec's `failed` rewrite.
- Rewrite only when a marker already exists for that entry run. This covers two no-marker cases the same way: an invocation settled before the marker existed (no re-notification on upgrade), and an invocation orphaned by a daemon crash before its workflow `finally` ran (00's crash gap) — daemon-start recovery never wrote one either, so the entry-run guard here makes a later republication rewrite a no-op instead of fabricating a cause.

## Acceptance criteria

- [x] A new test in `v2/src/daemon/daemon-run-lifecycle-handlers.test.ts` drives a completed workflow settlement (marker `completed`) followed by a failing republication through `resumeFinalizationOnly` — thrown-error path — and asserts the marker is rewritten to `failed`; it fails against the pre-fix code.
- [x] A test in the same file drives the same setup through the `failureAsResponse: true` path (`{ ok: false }` returned as a response, not thrown) and asserts the marker is still rewritten to `failed`; it fails against the pre-fix code.
- [x] In the same file, a test drives a completed workflow settlement, then aborts the republication tail via `run kill` (or a fired run timeout) mid-flight, and asserts the marker stays `completed` — ruling out an implementation that rewrites to `failed` on any tail rejection regardless of abort state. It passes on pre-fix code by design; it only guards the two tests above against an over-broad fix.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md`: a failed republication rewrites the settled marker to `failed`, unless the tail was aborted (kill or run timeout) or no marker exists yet for that entry run.
