# Pipeline admission context gate

## Problem

`handlePipelineStart` accepts any RPC `context` object, persists it verbatim, and passes the same RPC bytes into `runPipeline`. Continuation already reloads from the durable row, so fresh and restarted paths can diverge when admission validation is missing or bypassed.

## Decision ledger

- Validate RPC `context` through the shared loader from subspec 00 before `createPipeline` — rules out creating stage rows when `configPath` is absent.
- Return `invalid_params` with the loader error message when validation fails — rules out `admission_failed` for caller-supplied shape errors (that code stays for durable round-trip failures after a valid admit).
- After a successful admit transaction, reload context via the loader from `store.loadPipeline` and pass only that validated snapshot into `runPipeline` — rules out forwarding RPC `context` bytes into execution.
- CLI `admitPipelineStart` already supplies `configPath`; no new CLI flags in this slice.

## Task checklist

- Gate `handlePipelineStart` on the shared loader before `createPipeline`; refuse without inserting stages when validation fails.
- Change the post-admit `runPipeline` invocation to use reloaded validated context, not RPC params.
- Add `daemon-pipeline-start.test.ts` regression for missing `configPath` (no `pipelineId`, no stage rows).
- Add `daemon-pipeline-start.test.ts` or `pipeline-execution.test.ts` coverage that RPC context differing from the persisted snapshot is ignored after admit.
- Update `v2/docs/daemon-host.md` for admission validation and fresh execution consuming the same validated durable context as continuation.

## Acceptance criteria

- [x] `daemon-pipeline-start.test.ts` — a test calls `pipeline_start` with `context` missing `configPath` and asserts `invalid_params` (or equivalent refusal) with no pipeline row and no runnable stage state; it fails against the pre-fix permissive admission that creates stages.
- [x] `daemon-pipeline-start.test.ts` — `pipeline_start persists supplied context before returning pipelineId` stays green, and a sibling test asserts `runPipeline` receives reloaded persisted `configPath`/`cwd` when RPC bytes differ; the sibling fails against the pre-fix handler that forwards RPC `context` directly.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — `pipeline_start` validates `context` through the shared loader before admission; fresh execution reloads the validated durable snapshot through the same loader as restart continuation.
