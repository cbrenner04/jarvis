# Non-ok invocation results carry settlement on invocation_completed rows

`InvocationOk` alone carries optional `usage`, `usage_source`, `cost_usd`, `cost_source`, and `warnings`; `createInvocationCompletedRecord` (`shared/invocation/execute.ts`) reads them only when `kind === "ok"`, so quota, stall, error, and `model_config` subprocesses always emit null usage and `usage_source: "unavailable"` on `invocation_completed` even when the binding already measured counters.

## Decisions

- Introduce a shared optional settlement shape (same fields as on `InvocationOk`) and add those optional fields to `InvocationQuota`, `InvocationStall`, and both `InvocationError` variants — rules out a parallel result type or ok-only duplication.
- `createInvocationCompletedRecord` copies `usage`, `usage_source`, `cost_usd`, `cost_source`, and `warnings` from the settled `InvocationResult` regardless of `kind` — rules out the current `okResult`-only branch (`execute.ts` ~376–408).
- Omitted settlement on any kind keeps today's row defaults: all-null `usage`, `usage_source: "unavailable"`, `cost_usd: null`, `cost_source: "unavailable"`, `warnings: []` — rules out omitting keys on the emitted record.
- When the binding sets explicit `usage_source` / `cost_source` (including `"no-usage"` / `"no-price"`), the row copies them verbatim — rules out normalizing agent/catalog sources back to `"unavailable"`.
- Non-ok rows reuse the same partial-counter and `usage_source` / `cost_source` catalog semantics as `ok` when the binding supplies them on the settled result — rules out inventing separate provenance rules in telemetry docs only.
- `exit_kind`, `exit_reason`, and quota-fallback advance (`shouldAdvance` / default `kind === "quota"`) stay unchanged — rules out coupling settlement to classification or fallback policy.
- Each binding attempt in a fallback chain contributes only its own settlement on its row — rules out summing or forwarding prior-attempt usage onto a later row.
- Duration is never used to estimate tokens — rules out `"estimated"` usage invented at telemetry build time.
- Usage-capture problems append to `warnings` on the classified result; they do not change `kind` — rules out promoting a non-ok exit to `ok` when counters exist.
- Out of scope: binding-side recovery in `shared/invocation/agents.ts` / `agents.test.ts` (owned by `agent-bindings-recover-usage-on-failed-settlement`) — rules out touching bindings here; this lane proves the mapper with injected bindings only.

## Tasks

- Extend non-ok `InvocationResult` variants and refactor `createInvocationCompletedRecord` per decisions (extract settlement read helper if it clarifies the mapper).
- Extend `execute.test.ts`: injected `quota`, `error`, and `stall` bindings with agent-sourced settlement; two-binding fallback with distinct per-row usage; no-counter cases assert all-null usage and `usage_source: "unavailable"`; non-ok result carrying `warnings` asserts capped strings on the row.
- Update `execute.test.ts` `non-ok exit kinds and ok without warnings emit empty warnings array` so bare non-ok fixtures still expect `warnings: []` while settlement-bearing non-ok cases are covered separately.
- Align `v2/docs/shared-invocation.md`, `v2/docs/telemetry-capture.md`, and `v2/docs/v1-behaviors.md` per Documentation updates.

## Acceptance criteria

- [x] `shared/invocation/execute.test.ts` drives `executeWithQuotaFallback` with injected bindings whose `quota`, `error`, and `stall` results carry agent-sourced `usage`, `usage_source`, `cost_usd`, and `cost_source`, and proves `invocation_completed` rows preserve those fields plus `exit_kind`; a two-binding quota→error chain keeps distinct per-attempt usage on each row; bindings with no counters stay all-null usage with `usage_source: "unavailable"`; fails against the pre-fix ok-only mapping in `createInvocationCompletedRecord`.
- [x] `shared/invocation/execute.test.ts` — non-ok injected binding carrying `warnings` copies capped warning strings onto the `invocation_completed` row (same cap behavior as `ok`); fails against the pre-fix ok-only settlement branch in `createInvocationCompletedRecord`.
- [x] `shared/invocation/execute.test.ts` — `ok result with usage and cost records those exact values and sources` stays green.
- [x] `shared/invocation/execute.test.ts` — `appends one invocation_completed row per binding attempt in order` stays green.
- [ ] `bun run typecheck`, `bun run test:shared`, `bun run test:integration:shared`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/shared-invocation.md` — `invocation_completed` emission: non-ok exits copy binding-supplied settlement when present; omitted settlement keeps explicit null usage and `"unavailable"` sources (never assumed free); cross-link `telemetry-capture.md` for field catalog.
- `v2/docs/telemetry-capture.md` — non-ok `invocation_completed` usage/cost keys when the binding supplies settlement; partial-counter provenance matches `ok`; unavailable data stays explicit null; non-ok rows may carry adapter `warnings` when present on the settled result.
- `v2/docs/v1-behaviors.md` — shared `invocation_completed` rows carry binding-supplied usage/cost on non-ok exits when present (edit shared-invocation / agent JSONL bullets ~518–521 and `v2/docs/shared-invocation.md` contract text; supersede patch-mode line ~194 that non-`ok` results carry no usage fields where it still applies to v2 shared invocation).
