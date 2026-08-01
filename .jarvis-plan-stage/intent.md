---
name: shared-prices-compute-list-price-cost
---

# Shared prices module computes list-price cost from usage and priceKey

## Behavior

`shared/**` cannot import `v1/src/prices`, but invocation finalize needs the same
usage→dollars math `v1/src/prices/cost.ts` already implements against
`data/prices.json`. Add a shared price-load/compute module that reads the checked-in
catalog and returns `{ cost_usd, cost_source }` for a `priceKey` and measured usage.

## Decisions

- Costing lives in `shared/**` reading `data/prices.json`, not an import of `v1/src/prices` — rules out the layering violation `shared/**` forbids.
- `computeCost` is agent-agnostic and keyed on `priceKey` — rules out agent-specific pricing branches in the module.
- Return shape mirrors v1 `computeCost`: `cost_source: "computed"` when rates exist and usage is present; `no-price` for unknown keys or all-null rates; `no-usage` when usage is absent or all-null — rules out fabricated `0.0` or `unavailable` on the no-usage path.
- Cache-rate fallbacks match v1 (`cache_read_per_mtok` → `input_per_mtok`, `cache_write_per_mtok` → `input_per_mtok`) — rules out divergent cent math from the v1 catalog consumer.

## Acceptance criteria

- [ ] `computeCost(fixtureUsage, "Composer 2.5", loadPrices())` yields `cost_source: "computed"` and a `cost_usd` matching `data/prices.json` to the cent; a unit test in `shared/prices/` pins the value and fails against a missing module.
- [ ] `computeCost(fixtureUsage, "unknown-price-key", loadPrices())` yields `cost_usd: null` and `cost_source: "no-price"`; a regression test fails against the pre-fix absent path.
- [ ] `computeCost` with no usage (undefined or all-null token fields) yields `cost_usd: null` and `cost_source: "no-usage"`; a regression test fails against returning `0.0` or `unavailable`.
- [ ] Source-mutating the rate application (e.g. omitting `cache_read_input_tokens` from the sum) turns the Composer 2.5 pin test RED, with a comment checkpoint naming the mutation. Do **not** add a production test flag.
- [ ] `bun run typecheck` and `bun run test:shared` pass.

## Documentation updates

None — no operator-facing contract until shared invocation consumes this module.

## Prerequisites
