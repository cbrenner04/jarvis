# 01 - `invocation_completed` records agent-reported usage and cost

`createInvocationCompletedRecord` in `shared/invocation/execute.ts` writes
`usage: {input_tokens: null, …}`, `usage_source: "unavailable"`, `cost_usd: null`,
`cost_source: "unavailable"` on every row — the fields are typed `null` and never
read from the binding result. So even with subspec 00 landed, an `InvocationOk`
carrying `cost_usd`/`usage` from claude still records as unattributable: the
16/16 zero-dollar session observed 2026-07-13.

This subspec makes the record carry what the binding reported.

## Decisions

- Copy `usage`, `usage_source`, `cost_usd`, `cost_source` from an `ok` result onto
  the record; widen the record type to the `InvocationOk` field types. Rules out a
  claude-specific special case in `execute.ts` — the executor stays agent-agnostic
  and codex/cursor gain the same plumbing for free when they populate the fields.
- A result that omits a field keeps today's row: null usage, `usage_source:
  "unavailable"`, null cost, `cost_source: "unavailable"`. Rules out omitting the
  keys, which would break sheet readers that expect the columns.
- Non-`ok` results (quota / model_config / error) keep the unavailable row.

## Acceptance criteria

- [x] An `ok` result carrying `usage`/`cost_usd` with `"agent"` sources records those exact values and sources on its `invocation_completed` row.
- [x] An `ok` result with no usage/cost, and every non-`ok` result, still records null usage, null `cost_usd`, and `"unavailable"` sources.
- [x] A v2 write step whose claude binding returns a stream-json result event lands an `invocation_completed` row with non-null `cost_usd` and `cost_source: "agent"` (end-to-end over the subspec 00 binding, stubbed spawn).
- [x] Existing `shared/invocation/execute.test.ts` fallback, session-log, and telemetry-failure tests stay green (fallback and sink-failure behavior unchanged).

## Documentation updates

- `v2/docs/shared-invocation.md` — the telemetry bullet describes the row; state that usage/cost now come from the settled result.
- `v2/docs/v1-behaviors.md` — the `[v2 divergence]` entry saying shared telemetry usage/cost "stays unavailable until a billing-grade consumer requires it" is now false for claude; narrow it to codex.
