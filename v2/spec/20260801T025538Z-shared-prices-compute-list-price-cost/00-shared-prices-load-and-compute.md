# Shared prices load and compute

`shared/**` cannot import `v1/src/prices`, but downstream invocation finalize needs the same
usage→dollars math against `data/prices.json`. Add `shared/prices/` with catalog load and
`computeCost` returning `{ cost_usd, cost_source }` for a `priceKey` and measured usage.

## Decisions

- Costing lives in `shared/prices/` reading `data/prices.json`, not importing `v1/src/prices` — rules out the `shared/**` layering violation.
- `computeCost(usage, priceKey, prices)` is agent-agnostic and keyed on `priceKey` — rules out agent-specific pricing branches in the module.
- Return shape mirrors v1 `computeCost`: `cost_source: "computed"` when rates exist and usage is present; `no-price` for unknown keys or all-null rates; `no-usage` when usage is absent or all-null — rules out fabricated `0.0` or `unavailable` on the no-usage path.
- Cache-rate fallbacks match v1 (`cache_read_per_mtok` → `input_per_mtok`, `cache_write_per_mtok` → `input_per_mtok`) — rules out divergent cent math from the v1 catalog consumer.
- Port `loadPrices` validation and `computeCost` math from `v1/src/prices/{load,cost}.ts` — rules out a simplified reimplementation that diverges on edge cases v1 already pins.
- `loadPrices()` with no path resolves repo-root `data/prices.json` via `join(import.meta.dir, "..", "..", "data", "prices.json")` — two parent segments from `shared/prices/` (v1 `v1/src/prices/load.ts` uses three) — rules out cwd-relative, env-based, or v1-depth copy-paste resolution.
- Usage input uses a shared-local type with the same four token fields as v1 `TelemetryUsage` — rules out importing v1 telemetry types into `shared/**`.
- `COMPOSER_25_FIXTURE_USAGE` token counts come from `v2/spec/seeds/cursor-usage-is-parsed-then-discarded.md`; expected `cost_usd` `0.0038492` is arithmetic against checked-in `Composer 2.5` rates — rules out ad-hoc per-test usage that drifts from the catalog pin.
- Out of scope: invocation wiring, v1 delegation to shared — deferred to first consumer (`shared-invocation-computes-list-price-cost`).

## Tasks

- Add `shared/prices/load.ts` porting v1 catalog load, types, and validation.
- Add `shared/prices/load.test.ts` with temp-file cases for unknown version and negative-rate rejection (mirroring `v1/test/prices.test.ts`).
- Add `shared/prices/cost.ts` porting v1 `computeCost` with `priceKey` as the lookup argument name.
- Add `shared/prices/cost.test.ts` covering the Composer 2.5 pin, unknown `priceKey`, no-usage, all-null rates, all-zero `computed`, cache fallback without explicit cache columns, and a guard-inversion comment checkpoint on the pin test.
- Run `bun run typecheck`, `bun run test:shared`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2`.

## Acceptance criteria

- [x] `shared/prices/cost.test.ts` — `computeCost(COMPOSER_25_FIXTURE_USAGE, "Composer 2.5", loadPrices())` yields `cost_source: "computed"` and `cost_usd: 0.0038492`; fails against a missing `shared/prices/` module.
- [x] `shared/prices/cost.test.ts` — `computeCost(COMPOSER_25_FIXTURE_USAGE, "unknown-price-key", loadPrices())` yields `cost_usd: null` and `cost_source: "no-price"`; fails against the pre-fix absent module.
- [x] `shared/prices/cost.test.ts` — `computeCost` with `undefined` usage and with all-null token fields yields `cost_usd: null` and `cost_source: "no-usage"`; fails against returning `0.0` or `unavailable`.
- [x] `shared/prices/cost.test.ts` — all-null rates for a known `priceKey` yield `cost_usd: null` and `cost_source: "no-price"`; fails against the pre-fix absent module.
- [x] `shared/prices/cost.test.ts` — all-zero token fields with valid rates yield `cost_source: "computed"` and `cost_usd: 0`; fails against the pre-fix absent module.
- [x] `shared/prices/cost.test.ts` — cache read/write usage with no explicit cache rate columns falls back to `input_per_mtok`; fails against the pre-fix absent module.
- [x] `shared/prices/load.test.ts` — temp-file `loadPrices(path)` rejects unknown version and negative rates (mirroring `v1/test/prices.test.ts`); fails against a trivial `JSON.parse` wrapper.
- [x] `shared/prices/cost.test.ts` — the Composer 2.5 pin test includes a comment checkpoint naming the required guard-inversion mutation (e.g. omitting `cache_read_input_tokens` from the sum).
- [ ] Source-mutating the rate application (e.g. omitting `cache_read_input_tokens` from the sum) turns the Composer 2.5 pin test RED. Do **not** add a production test flag. (Manual)
- [x] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2` pass; `bun run test:shared` passes.

## Documentation updates

None — no operator-facing contract until shared invocation consumes this module.
