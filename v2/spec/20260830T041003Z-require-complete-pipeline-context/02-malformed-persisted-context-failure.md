# Malformed persisted context fails stage

## Problem

A legacy or manually corrupted row can store `context` JSON without `configPath`. `continuePipeline` and `runPipeline` treat any non-null JSON as usable, then `stampPipelineDispatchSteps` throws a generic message during dispatch — or dispatch proceeds with fallback config. The pending stage should fail closed with the named loader error and record no workflow dispatch.

## Decision ledger

- Run the shared loader when execution needs pipeline context (fresh `runPipeline` after subspec 01 reload and continuation `continuePipeline` / stage advance) — rules out trusting raw `pipeline.context` on the hot path.
- On loader failure with non-null stored JSON, fail the pending workflow stage with `failure_detail.message` prefixed by `pipeline-context-loader` and skip dispatch — rules out `continuePipeline` refusing with `missing_context` for incomplete JSON (that reason stays for `context === null` only).
- Do not synthesize `configPath` from `MACHINE_CONFIG_PATH` or operator-home config — rules out continuation-time completion of admission fields.

## Task checklist

- In `pipeline-execution.ts` (and any shared helper both fresh and continuation paths call), validate context through the loader before stage resolution/dispatch; call existing stage-failure helpers on loader errors.
- Ensure `advanceWorkflowStage` / fan-out dispatch never call `dispatchPipelineStage` when validation fails.
- Add `pipeline-execution.test.ts` regression that seeds a pipeline row with `{ cwd, seed }` context JSON, runs continuation or `runPipeline`, asserts the pending stage `failed` with a `pipeline-context-loader` message, and asserts dispatch was not called.
- Add `pipeline-execution.test.ts` coverage that a valid admitted context yields the same `cwd` and `configPath` through fresh `runPipeline` and `continuePipeline` resolution inputs.
- Update `v2/docs/v1-behaviors.md` and align `v2/docs/state-store.md` / `v2/docs/daemon-host.md` with fail-closed loading semantics.

## Acceptance criteria

- [ ] `pipeline-execution.test.ts` — a test seeds persisted context JSON without `configPath`, drives `runPipeline` or `continuePipeline`, asserts the pending workflow stage is `failed` with a `pipeline-context-loader` message, and asserts no workflow dispatch occurred; it fails against the pre-fix path that reaches `stampPipelineDispatchSteps` or dispatches with defaults.
- [ ] `pipeline-execution.test.ts` — a test asserts fresh execution and continuation pass equal `cwd` and `configPath` into stage resolution for a valid admitted snapshot; it fails if either path uses different bytes (RPC vs durable) or skips validation.
- [ ] `v2/docs/v1-behaviors.md` — replace optional-`configPath` pipeline context semantics with fail-closed loader behavior for incomplete persisted JSON.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — catalog fail-closed `PipelineContext` loading; `configPath` is required admission state, not optional on persisted rows at execution time.
- `v2/docs/state-store.md` — incomplete persisted JSON fails at execution via `pipeline-context-loader`, not at opaque parse time.
- `v2/docs/daemon-host.md` — continuation and fresh execution share the validated loader path; incomplete context fails the stage before dispatch.
