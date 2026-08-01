# Cursor finalize computed list-price cost

`finalizeCursorInvocationResult` surfaces agent-reported usage with `cost_source: "no-price"`.
Thread the binding's `priceKey` through `runCursorBinding` / `finalizeCursorInvocationResult`
and call shared `computeCost` so measured usage yields list-price `cost_usd` and
`cost_source: "computed"`. No-usage and unpriced-key paths stay as today.

## Decisions

- `priceKey` is threaded from `createResolvedAgentBinding` into cursor finalize — rules out re-resolving the price key from `adapterModel` at the finalize site.
- Harness-derived dollars use `cost_source: "computed"`; reserve `"agent"` for CLI-reported spend — rules out mislabeling list-price math as agent-reported cost.
- With parsed usage and a priced `priceKey`, call `computeCost(usage, priceKey, loadPrices())` — rules out hard-coded rates or a cursor-only cost helper.
- No-usage path keeps `cost_usd: null` and `cost_source: "no-usage"` — rules out `cost_source: "unavailable"` or fabricated `0.0` on that path.
- With parsed usage and an unknown or all-null-rate `priceKey`, keep `cost_usd: null` and `cost_source: "no-price"` — rules out computing against a missing catalog row.
- Computed `cost_usd` is published-rate list price, not billed spend (cursor is subscription-billed) — rules out docs or operator guidance presenting the figure as invoice spend.
- Out of scope: back-filling historical telemetry rows and the same computed-cost gap for other adapters reporting `unavailable` — check those once this path proves out.

## Tasks

- Pass `priceKey` from `createResolvedAgentBinding` into `runCursorBinding` and `finalizeCursorInvocationResult`.
- On the with-usage finalize branch, set `cost_usd` / `cost_source` from `computeCost`; preserve display-text unwrap and non-`ok` passthrough.
- Add `agents.test.ts` coverage: priced `Composer 2.5` `priceKey` + terminal usage → `computed` + pinned `cost_usd`; unknown `priceKey` + usage → `no-price`; no terminal `usage` → `no-usage` regression.
- Update the existing with-usage cursor binding test (`priceKey: "composer"`, unpriced) to keep `no-price` expectations.
- Add guard-inversion comment checkpoint on the computed-cost pinning test naming the usage-field-mapping mutation below.
- Update `v2/docs/shared-invocation.md`, `v2/docs/telemetry-capture.md`, `v2/docs/operator-runbook.md` (§ Reading telemetry), and `v2/docs/v1-behaviors.md`.
- Run `bun run typecheck` and `bun run test:shared`.

## Acceptance criteria

- [ ] `agents.test.ts` — cursor binding with terminal `usage`, `priceKey: "Composer 2.5"`, and `COMPOSER_25_FIXTURE_USAGE` token counts settles `ok` with `usage_source: "agent"`, `cost_source: "computed"`, and `cost_usd` matching `data/prices.json` to the cent (`0.0038492`); `invocation_completed` telemetry preserves those fields; fails against the pre-fix `no-price` / `0.0` / `unavailable` path.
- [ ] `agents.test.ts` — cursor binding with terminal usage and `priceKey: "unknown-price-key"` keeps `cost_usd: null` and `cost_source: "no-price"`; fails if finalize computes cost without a catalog row.
- [ ] `agents.test.ts` — cursor binding with no terminal `usage` keeps `cost_usd: null` and `cost_source: "no-usage"`; fails against a finalize path that computes or emits `no-price` on the no-usage branch.
- [ ] `agents.test.ts` — the computed-cost pinning test includes a comment checkpoint naming the guard-inversion mutation (e.g. swapping `cacheReadTokens` into `input_tokens` in `cursor-json.ts` usage mapping).
- [ ] Source-mutating the usage field mapping (e.g. swapping `cacheReadTokens` into `input_tokens` in `cursor-json.ts`) turns the computed-cost test RED. Do **not** add a production test flag.
- [ ] `agents.test.ts` — cursor quota classification, spawn argv, idle-timer threading, and non-`ok` passthrough tests stay green.
- [ ] `bun run typecheck` and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/shared-invocation.md` — cursor finalize: `computed` when usage + priced `priceKey`; `no-price` when key unpriced; list-price, not billed spend.
- `v2/docs/telemetry-capture.md` — `cost_source: "computed"` semantics; list-price, not billed spend; cursor branches (`computed` / `no-price` / `no-usage`).
- `v2/docs/operator-runbook.md` § Reading telemetry — agent-cost column meaningful for cursor from this change forward; pre-computed rows lack comparable `cost_usd` (`no-price`/`no-usage`).
- `v2/docs/v1-behaviors.md` — shared cursor invocation surfaces list-price `cost_usd` on `InvocationOk` / `invocation_completed` rows when usage is present and `priceKey` is priced.
