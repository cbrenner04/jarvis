# Emit invocation-completed rows at the shared write-step seam

## Problem

v2 has a durable telemetry contract but no runtime emitter, so Phase 5 write
steps still produce no append-only analysis facts.

## Decisions

- Emit `invocation_completed` from the shared invocation seam after each binding subprocess settles; rules out reconstructing rows later from logs, git, or SQLite.
- Scope the first runtime consumer to write-workflow invocations only; rules out bundling review-debate, human, `work_boundary_recorded`, or `run_terminal` into this slice.
- Emit one row per binding subprocess in quota fallback order, with one shared caller-owned logical attempt identity (`run_id` + `attempt_id` + step context) across the chain and one distinct `invocation_id` per subprocess row; rules out one aggregate row for a logical invocation or later re-keying per subprocess.
- Pass run, attempt, step, and invocation context in from the write/workflow caller; rules out minting IDs inside the emitter with no orchestration join.
- Emit only when the caller passes write-step telemetry context plus a sink; otherwise shared invocation execution is a no-op for telemetry; rules out accidental emission changes for other `shared/invocation/execute.ts` callers.
- Write to an append-only JSONL sink on an injectable path; rules out storing analysis facts in orchestration SQLite or the observability log.
- Surface telemetry append failure separately while preserving the settled invocation result; rules out silent row loss and rules out telemetry sink failures changing binding fallback or runner classification.
- Emit unavailable usage and cost fields as explicit `null`; rules out absent-key inference in later consumers.
- Emit after subprocess settle and before runner token parsing or contract classification; rules out suppressing rows for later `contract_miss` or `invalid_token` outcomes.

## Tasks

- Add a shared telemetry sink/emitter seam that appends `invocation_completed` JSONL rows from shared invocation execution.
- Thread the write-step caller context needed by the capture contract into shared invocation execution, including stable run, attempt, step, worktree, binding metadata, shared logical-attempt identity, and per-subprocess invocation identity.
- Gate emission on provided write-step telemetry context plus sink, leaving other shared-invocation callers as telemetry no-ops.
- Cover settled-success, quota-fallback, downstream non-success classification, sink-failure surfacing, no-op gating, and unavailable-usage cases with unit tests against an injected sink.
- Update durable docs in `v2/docs/telemetry-capture.md`, `v2/docs/shared-step-runner.md`, and `v2/docs/shared-invocation.md`.

## Documentation updates

- `v2/docs/telemetry-capture.md` — pin quota-fallback grain, logical-attempt vs per-subprocess identity, sink-failure behavior, and mark write-step runtime coverage as live.
- `v2/docs/shared-step-runner.md` — replace the future-emitter note with the live write-step boundary and note that later runner classification does not gate emission.
- `v2/docs/shared-invocation.md` — document `invocation_completed` emission at the shared invocation seam, the write-only no-op gate, and the append-failure rule.

## Acceptance criteria

- [x] When a write step provides telemetry context and a sink path, each binding subprocess appends one `invocation_completed` JSONL row immediately after it settles, with caller-owned `run_id`, `attempt_id`, and step context shared across quota fallback rows and a distinct `invocation_id` on each subprocess row rather than later re-keyed identities.
- [x] Quota fallback across multiple bindings appends one `invocation_completed` row per binding subprocess in attempt order, including the terminal non-quota stop or final quota exhaustion, rather than one aggregate logical-invocation row.
- [x] Shared invocation callers that do not provide write-step telemetry context plus sink path produce the same invocation outcomes as before and append no telemetry rows.
- [x] `invocation_completed` rows emit explicit `null` values for unavailable usage and cost fields instead of omitting those keys.
- [x] A settled subprocess still appends its `invocation_completed` row even when the step runner later classifies the attempt as a downstream non-success such as `contract_miss` or `invalid_token`.
- [x] If the telemetry sink append fails after a subprocess settles, the write step still returns the underlying invocation outcome and surfaces the append failure separately instead of silently dropping it or changing binding fallback behavior.
- [x] The write-step runtime can inject the telemetry sink path without changing orchestration SQLite recovery state or observability log event contracts.
- [x] `v2/docs/telemetry-capture.md`, `v2/docs/shared-step-runner.md`, and `v2/docs/shared-invocation.md` describe the live write-step emitter and its boundary consistently.
