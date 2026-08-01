---
name: shared-invocation-cursor-computed-cost
---

# Shared cursor invocation records harness-computed list-price cost

## Behavior

Cursor finalize already surfaces agent-reported usage with `cost_source: "no-price"`.
Thread the binding's `priceKey` into `runCursorBinding` / `finalizeCursorInvocationResult`
and call the shared `computeCost` helper so measured usage yields `cost_usd` at published
rates and `cost_source: "computed"`. No-usage and unpriced-key paths stay as today.

## Decisions

- `priceKey` is threaded from `createResolvedAgentBinding` into the cursor binding's finalize — rules out re-resolving the price key from `adapterModel` at the finalize site.
- Harness-derived dollars use `cost_source: "computed"`; reserve `"agent"` for CLI-reported spend — rules out mislabeling list-price math as agent-reported cost.
- No-usage path keeps `cost_usd: null` and `cost_source: "no-usage"` — rules out `cost_source: "unavailable"` or fabricated `0.0` on that path.
- A computed figure is list price, not billed spend: cursor is subscription-billed, so docs must say the number is published-rate token cost — rules out reports presenting it as invoice spend.
- Out of scope: back-filling historical telemetry rows, and the same gap for other adapters reporting `unavailable` — check those once this path proves out.

## Acceptance criteria

- [ ] A cursor invocation whose terminal frame carries usage and a `Composer 2.5` `priceKey` records `cost_source: "computed"` and a `cost_usd` matching `data/prices.json` to the cent; a fixture-driven test in `shared/invocation/agents.test.ts` pins the value and fails against the pre-fix `0.0` / `unavailable` / `no-price`.
- [ ] A cursor invocation with no terminal `usage` keeps `cost_usd: null` and `cost_source: "no-usage"`; a regression in `agents.test.ts` fails against the pre-fix path.
- [ ] Source-mutating the usage field mapping (e.g. swapping `cacheReadTokens` into `input_tokens`) turns the computed-cost test RED, with a comment checkpoint naming the mutation. Do **not** add a production test flag.
- [ ] `bun run typecheck` and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/telemetry-capture.md` — `cost_source: "computed"` semantics; list-price, not billed spend.
- `v2/docs/operator-runbook.md` § reading telemetry — the agent-cost column is meaningful for cursor from this change forward; earlier rows read `unavailable` and cannot be compared.
- `v2/docs/v1-behaviors.md` — shared cursor invocation surfaces list-price `cost_usd` on `InvocationOk` / `invocation_completed` rows when usage is present.

## Prerequisites

- `parseCursorJsonOutput` returns the terminal `result` frame's token usage alongside `displayText`
- Cursor invocations record `usage_source: "agent"` with non-null usage fields in telemetry
- Cursor invocations with no usage frame record `usage_source: "unavailable"` and `cost_source: "no-usage"`
- `data/prices.json` carries a `Composer 2.5` entry and the cursor binding resolves that `priceKey`
- Shared `computeCost(usage, priceKey, prices)` reads `data/prices.json` and returns list-price `cost_usd` with `cost_source: "computed"` for priced keys and measured usage
