# 00 — Non-ok invocation results carry recovered usage into telemetry

`createInvocationCompletedRecord` (`shared/invocation/execute.ts`) reads `usage` / `usage_source` / `cost_usd` / `cost_source` / `warnings` only from `kind: "ok"`, so adapters that recover token counters onto quota/stall/error/model_config results still emit all-null usage on `invocation_completed` rows.

## Decisions

- Add the same optional usage/cost/warning fields `InvocationOk` already carries onto every non-`ok` `InvocationResult` variant (`quota`, `stall`, `model_config`, `error`) — rules out a parallel DTO or a side channel only bindings read.
- `createInvocationCompletedRecord` maps those fields from whichever variant settled, using the same defaults as today when a field is absent (`usage` all-null object, `usage_source: "unavailable"`, `cost_usd: null`, `cost_source: "unavailable"`, `warnings: []`) — rules out ok-only telemetry while bindings attach recovered usage.
- Non-ok rows still carry adapter `warnings` when present on the settled result — rules out the pre-fix ok-only `warnings` mapping on `execute.test.ts` non-ok fixtures.
- Out of scope: binding-side stream/session recovery (subspec 01/02), changing exit classification, and delaying settlement for recovery I/O.

## Tasks

- Extend `InvocationQuota`, `InvocationStall`, and `InvocationError` union members with the optional usage/cost/warning fields mirroring `InvocationOk`.
- Update `createInvocationCompletedRecord` to read usage provenance from any settled `InvocationResult` kind.
- Add `execute.test.ts` coverage with injected bindings (no live agents): non-ok results that carry recovered usage and warnings assert the emitted `invocation_completed` row; non-ok without usage asserts today's null/unavailable defaults.
- Run `bun run typecheck`, `bun run test:shared`, and `bun run test:integration:shared`.

## Acceptance criteria

- [ ] `execute.test.ts` — a `quota` attempt whose result includes recovered `usage`, `usage_source: "agent"`, computed `cost_usd` / `cost_source`, and `warnings` emits an `invocation_completed` row carrying those exact fields; fails against the pre-fix mapper that only reads `InvocationOk`.
- [ ] `execute.test.ts` — each non-ok `exit_kind` without recovered usage fields still emits null usage, `usage_source: "unavailable"`, `cost_usd: null`, `cost_source: "unavailable"`, and `warnings: []`.
- [ ] `execute.test.ts` — `appends one invocation_completed row per binding attempt in order` stays green.
- [ ] `bun run typecheck`, `bun run test:shared`, and `bun run test:integration:shared` pass.

## Documentation updates

- None (type/telemetry seam only; operator-facing adapter recovery is documented in subspecs 01–02).
