---
name: shared-invocation-computes-list-price-cost
---

# Shared invocation derives list-price cost from usage and the binding's priceKey

## Behavior

The shared invocation path never converts usage into dollars: only agents that self-report cost
(claude) set `cost_usd`. `data/prices.json` prices `Composer 2.5`, and
`createResolvedAgentBinding` already resolves `priceKey`, but `priceKey` is used only in the
binding id and never reaches `runCursorBinding`. The usage→cost path exists only in `v1/src/prices`,
which `shared/**` must not import.

After this change the shared invocation layer computes `cost_usd` from measured usage and the
binding's `priceKey` against `data/prices.json`, recording `cost_source: "computed"`. A cursor
invocation with a priced model records a `cost_usd` matching `data/prices.json` to the cent; an
unpriced `priceKey` records `cost_usd: null` with `cost_source: "no-price"`; an invocation with no
usage keeps `cost_usd: null` with `cost_source: "no-usage"` and does not report a fabricated `0.0`
as measured.

## Decisions

- Costing lives in a shared price-lookup/compute module reading `data/prices.json`, not an import of `v1/src/prices` — rules out the layering violation `shared/**` forbids.
- Costing is agent-agnostic and keyed on `priceKey`, applied wherever the binding reports usage without cost — rules out a cursor-specific pricing branch parallel to the shared one.
- `priceKey` is threaded from `createResolvedAgentBinding` into the cursor binding's finalize — rules out re-resolving the price key from `adapterModel` at the finalize site.
- Harness-derived dollars use `cost_source: "computed"`; reserve `"agent"` for CLI-reported spend (claude `total_cost_usd`, opencode `part.cost`) — rules out mislabeling list-price math as agent-reported cost.
- No-usage path keeps `cost_usd: null` and `cost_source: "no-usage"` — matches opencode finalize and the usage slice; rules out `cost_source: "unavailable"` or fabricated `0.0` on that path.
- A computed figure is list price, not billed spend: cursor is subscription-billed, so the number is what these tokens would cost at published rates, and docs must say so — rules out reports presenting it as invoice spend.
- Out of scope: back-filling historical telemetry rows, and the same gap for other adapters reporting `unavailable` — check those once this path proves out.

## Acceptance criteria

- [ ] A cursor invocation whose terminal frame carries usage and a `Composer 2.5` `priceKey` records `cost_source: "computed"` and a `cost_usd` matching `data/prices.json` to the cent; a fixture-driven test in `shared/invocation/agents.test.ts` pins the value and fails against the pre-fix `0.0` / `unavailable`.
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
