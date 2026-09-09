---
name: binding-invocation-failure-records-telemetry
---

# A binding that fails before producing a result still records telemetry

## Problem

A `plan` dispatch can settle `invocation_error` with zero rows in `~/.jarvis/telemetry.jsonl`, so the per-role audit trail the runbook designates for attribution is empty: no `agent`, `model`, `binding_id`, `exit_kind` or `exit_reason` for any rung in the chain. Evidence: runs `056da7b7` and `d6e7a552` (2026-09-08), both settling at ~8s with `iterationsConsumed: 1` and no telemetry, from healthy agent binaries and a fresh worktree.

## Decisions

- Telemetry is appended for a binding whose invocation fails before returning a result, carrying at minimum the attempted `agent`, `model`, `binding_id` and a failure `exit_kind`; rules out the current path where only result-producing invocations are recorded.
- The failure row is written before the chain can settle the run; rules out best-effort recording that a fast settle can outrun.
- Every attempted binding in the chain gets its own row; rules out recording only the last rung when the flat agent list has three entries.
- A sink append that itself fails is still surfaced through the existing telemetry-failure channel, never thrown; rules out observability turning into an invocation failure.
- Scope is the recording path, not the underlying spawn defect, which the evidence does not identify; rules out a fix that assumes a root cause.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Reading telemetry: a binding failure always leaves a row, so an empty query is evidence of absence rather than an unrecorded failure.
- `v2/docs/v1-behaviors.md` — telemetry now covers pre-result binding failures.

## Prerequisites

- Invocation telemetry rows are appended through a configured JSONL sink during binding execution.
- A binding carries agent/model metadata and a stable binding id at invocation time.
