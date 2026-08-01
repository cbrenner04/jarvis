# Cursor finalize computed list-price cost

`finalizeCursorInvocationResult` surfaces agent-reported usage with `cost_source: "no-price"`.
Thread the binding's `priceKey` through `runCursorBinding` / `finalizeCursorInvocationResult`
and call shared `computeCost` so measured usage yields list-price `cost_usd` and
`cost_source: "computed"`. No-usage and unpriced-key paths stay as today.

## Decisions

- `priceKey` is threaded from `createResolvedAgentBinding` into cursor finalize only — signature asymmetry with sibling bindings is acceptable; rules out re-resolving the price key from `adapterModel` at the finalize site.
- Harness-derived dollars use `cost_source: "computed"`; reserve `"agent"` for CLI-reported spend — rules out mislabeling list-price math as agent-reported cost.
- `finalizeCursorInvocationResult` keeps its own absent-usage branch (`parsed.usage === undefined`) and never calls `computeCost` on that path, regardless of whether `priceKey` is priced — rules out an unpriced `priceKey` plus absent usage yielding `no-price` instead of `no-usage`.
- With parsed usage and a priced `priceKey`, call `computeCost(usage, priceKey, prices)` — rules out hard-coded rates or a cursor-only cost helper.
- `loadPrices()` is called per invocation on the with-usage finalize branch (no new module-level cache); a throw (missing, unparseable, or invalid catalog) is caught and degrades to `cost_usd: null` / `cost_source: "no-price"` rather than failing the invocation — rules out catalog problems aborting an otherwise-successful cursor run.
- No-usage path keeps `cost_usd: null` and `cost_source: "no-usage"` — rules out `cost_source: "unavailable"` or fabricated `0.0` on that path.
- With parsed usage and an unknown `priceKey` (no matching catalog row), keep `cost_usd: null` and `cost_source: "no-price"` — rules out computing against a missing catalog row.
- When a terminal usage frame is present but all token fields are null, finalize still treats usage as present (`usage_source: "agent"`) and delegates to `computeCost`, which yields `cost_source: "no-usage"` for zero-quantity usage — rules out treating all-null usage as the absent-usage branch.
- Computed `cost_usd` is published-rate list price, not billed spend (cursor is subscription-billed) — rules out docs or operator guidance presenting the figure as invoice spend.
- Out of scope: back-filling historical telemetry rows; cost aggregation and run-summary blending of list-price cursor dollars with agent-reported spend; and the same computed-cost gap for other adapters currently reporting `no-price` or `unavailable` cost (opencode, claude, codex differ) — check those once this path proves out.

## Tasks

- Pass `priceKey` from `createResolvedAgentBinding` into `runCursorBinding` and `finalizeCursorInvocationResult`.
- On the with-usage finalize branch, set `cost_usd` / `cost_source` from `computeCost(usage, priceKey, loadPrices())`, catching a `loadPrices()` throw into `cost_usd: null` / `cost_source: "no-price"`; keep the absent-usage branch untouched; preserve display-text unwrap and non-`ok` passthrough.
- Add `agents.test.ts` coverage: priced `Composer 2.5` `priceKey` + locally declared terminal `result` frame (camelCase fields `inputTokens: 4023`, `outputTokens: 27`, `cacheReadTokens: 8851`, `cacheWriteTokens: 0`) → `computed` + pinned `cost_usd`; unknown `priceKey` + usage → `no-price`; no terminal `usage` with unpriced `priceKey: "composer"` (`COMPOSER_CURSOR_BINDING`) → `no-usage` regression.
- Update the existing with-usage cursor binding test (`priceKey: "composer"`, unpriced) to keep `no-price` expectations.
- Update `v2/docs/shared-invocation.md`, `v2/docs/telemetry-capture.md`, `v2/docs/operator-runbook.md` (§ Reading telemetry), and `v2/docs/v1-behaviors.md` (supersede the ~line 404 cursor-with-usage `cost_source: "no-price"` entry).
- Run `bun run typecheck` and `bun run test:shared`.

## Acceptance criteria

- [x] `agents.test.ts` — cursor binding with terminal `usage`, `priceKey: "Composer 2.5"`, and a locally declared terminal `result` frame (`inputTokens: 4023`, `outputTokens: 27`, `cacheReadTokens: 8851`, `cacheWriteTokens: 0`; declared in `agents.test.ts`, not imported from `cost.test.ts`) settles `ok` with `usage_source: "agent"`, `cost_source: "computed"`, and `cost_usd` matching `data/prices.json` to full precision (`0.0038492`); `invocation_completed` telemetry preserves those fields; fails against the pre-fix `no-price` / `0.0` / `unavailable` path.
- [x] `agents.test.ts` — cursor binding with terminal usage and `priceKey: "unknown-price-key"` keeps `cost_usd: null` and `cost_source: "no-price"`; fails if finalize computes cost without a catalog row.
- [x] `agents.test.ts` — cursor binding with no terminal `usage` and unpriced `priceKey: "composer"` (`COMPOSER_CURSOR_BINDING`) keeps `cost_usd: null` and `cost_source: "no-usage"`; fails against a finalize path that routes the no-usage branch through `computeCost` or emits `no-price`.
- [x] `agents.test.ts` — source-mutating a finalize-branch guard (e.g. routing the no-usage path through `computeCost`, or omitting the `priceKey` thread into `finalizeCursorInvocationResult`) turns the computed-cost pinning test RED; the test carries a comment checkpoint naming the mutation. Do **not** add a production test flag.
- [x] `agents.test.ts` — `cursor binding classifies quota (ASCII and U+2019), model config, and generic errors` stays green.
- [x] `agents.test.ts` — `cursor binding invokes the CLI shape with mapped model, cwd, ignored stdin, and abort signal` stays green.
- [x] `agents.test.ts` — `cursor binding threads idleOutputMs through and re-arms the idle timer on stdout` stays green.
- [x] `agents.test.ts` — `cursor binding passes non-ok results through unnormalized` stays green.
- [x] `bun run typecheck` and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/shared-invocation.md` — cursor finalize: `computed` when usage + priced `priceKey`; `no-price` when key unpriced or catalog load fails; list-price, not billed spend.
- `v2/docs/telemetry-capture.md` — `cost_source: "computed"` semantics; list-price, not billed spend; cursor branches (`computed` / `no-price` / `no-usage`).
- `v2/docs/operator-runbook.md` § Reading telemetry — agent-cost column meaningful for cursor from this change forward; pre-computed rows lack comparable `cost_usd` (`no-price`/`no-usage`).
- `v2/docs/v1-behaviors.md` — supersede the ~line 404 cursor-with-usage `cost_source: "no-price"` entry: shared cursor invocation surfaces list-price `cost_usd` on `InvocationOk` / `invocation_completed` rows when usage is present and `priceKey` is priced.
