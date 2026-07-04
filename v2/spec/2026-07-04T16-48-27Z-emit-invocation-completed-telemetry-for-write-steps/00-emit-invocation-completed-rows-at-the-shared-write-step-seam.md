# Emit invocation-completed rows at the shared write-step seam

## Problem

v2 has a durable telemetry contract but no runtime emitter, so Phase 5 write
steps still produce no append-only analysis facts.

## Decisions

- Emit `invocation_completed` from the shared invocation seam after each binding subprocess settles; rules out reconstructing rows later from logs, git, or SQLite.
- Scope the first runtime consumer to write-workflow invocations only; rules out bundling review-debate, human, `work_boundary_recorded`, or `run_terminal` into this slice.
- Emit one row per binding attempt in quota fallback order; rules out one aggregate row for a logical invocation.
- Pass run, attempt, step, and invocation context in from the write/workflow caller; rules out minting IDs inside the emitter with no orchestration join.
- Write to an append-only JSONL sink on an injectable path; rules out storing analysis facts in orchestration SQLite or the observability log.
- Emit unavailable usage and cost fields as explicit `null`; rules out absent-key inference in later consumers.

## Tasks

- Add a shared telemetry sink/emitter seam that appends `invocation_completed` JSONL rows from shared invocation execution.
- Thread the write-step caller context needed by the capture contract into shared invocation execution, including stable run, attempt, step, worktree, and binding metadata.
- Cover settled-success, quota-fallback, and unavailable-usage cases with unit tests against an injected sink.
- Update durable docs in `v2/docs/telemetry-capture.md`, `v2/docs/shared-step-runner.md`, and `v2/docs/shared-invocation.md`.

## Documentation updates

- `v2/docs/telemetry-capture.md` — pin quota-fallback grain and mark write-step runtime coverage as live.
- `v2/docs/shared-step-runner.md` — replace the future-emitter note with the live write-step boundary.
- `v2/docs/shared-invocation.md` — document `invocation_completed` emission at the shared invocation seam.

## Acceptance criteria

- [ ] A write-step invocation appends one `invocation_completed` JSONL row to the configured telemetry sink immediately after each binding subprocess settles, with the capture-contract IDs and write-step context carried from the caller rather than reconstructed later.
- [ ] Quota fallback across multiple bindings appends one `invocation_completed` row per binding attempt in attempt order, including the terminal non-quota stop or final quota exhaustion, rather than one aggregate logical-invocation row.
- [ ] `invocation_completed` rows emit explicit `null` values for unavailable usage and cost fields instead of omitting those keys.
- [ ] The write-step runtime can inject the telemetry sink path without changing orchestration SQLite recovery state or observability log event contracts.
- [ ] `v2/docs/telemetry-capture.md`, `v2/docs/shared-step-runner.md`, and `v2/docs/shared-invocation.md` describe the live write-step emitter and its boundary consistently.
