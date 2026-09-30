---
name: invocation-completed-records-failure-usage
---

# invocation_completed rows carry usage for non-ok exits

## Problem

`InvocationOk` alone carries usage and cost fields, and `createInvocationCompletedRecord` reads them only when `kind` is `ok`, so quota, stall, and error subprocesses always emit null usage on `invocation_completed` even when the binding already measured tokens.

## Behavior

This intent owns extending `InvocationQuota`, `InvocationStall`, `InvocationError`, and model_config results in `shared/invocation` with the same optional `usage`, `usage_source`, `cost_usd`, `cost_source`, and `warnings` shape as `ok`; agent bindings populate recovered values on those fields without redefining the types (sibling intent `agent-bindings-recover-usage-on-failed-settlement`). The telemetry builder copies those fields for every exit kind without changing `exit_kind`, `exit_reason`, or fallback advance rules. Each binding attempt in a fallback chain contributes only its own settlement to its row. When counters are absent, usage fields stay null and cost stays unpriced (`no-usage` / `unavailable` per existing catalog rules); duration is never used to estimate tokens. Usage-capture failures append warnings and never replace the classified outcome.

## Acceptance criteria

- [ ] `shared/invocation/execute.test.ts` drives `executeWithQuotaFallback` with injected bindings whose `quota`, `error`, and `stall` results carry agent-sourced usage and proves `invocation_completed` rows preserve usage, sources, cost, `exit_kind`, and distinct per-attempt usage across a two-binding fallback chain; cases with no counters stay all-null usage with `usage_source: "unavailable"`; fails against pre-fix ok-only mapping.
- [ ] `bun run typecheck`, `bun run test:shared`, `bun run test:integration:shared`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/telemetry-capture.md` — non-ok `invocation_completed` usage and cost keys, partial-counter provenance, and unavailable-data semantics (null, never assumed free).
- `v2/docs/v1-behaviors.md` — non-ok `invocation_completed` usage and cost when bindings supply counters.

## Prerequisites
