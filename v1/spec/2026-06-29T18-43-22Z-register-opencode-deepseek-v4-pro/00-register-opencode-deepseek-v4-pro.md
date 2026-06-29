# Register opencode/deepseek-v4-pro

`{ agent: "opencode", model: "opencode/deepseek-v4-pro" }` already round-trips config validation (`resolveOpencodePriceKey` returns the model verbatim). Without a `data/prices.json` row, harness fallback costing yields `cost_source: "no-price"` on estimated-usage enrichment and on agent-usage-without-cost enrichment. Operator opt-in: validation unchanged, `opencode run --model` receives the configured string, session usage costs against the owner price row when either fallback enrichment path runs.

## Prerequisites

- Draft-time verified: slug `opencode/deepseek-v4-pro` in `opencode models`; owner Zen snapshot `as_of` `2026-06-29`.
- Live `opencode run --model opencode/deepseek-v4-pro` acceptance unverified at draft time — deferred to human-only AC.

## Decisions

- Registration-only — do not change default `agentOrder` or `DEFAULT_AGENT_MODELS` (`config.ts:140` stays `opencode/deepseek-v4-flash-free`); rules out promoting `opencode/deepseek-v4-pro` to the bootstrapped default.
- Add only the `opencode/deepseek-v4-pro` row to `data/prices.json` with the owner snapshot and cited `source_url`; rules out implementer-invented rates and rules out a codex-style `OPENCODE_PRICE_KEYS` allowlist change (`resolveOpencodePriceKey` already passes any model string).

```json
"opencode/deepseek-v4-pro": {
  "input_per_mtok": 1.74,
  "output_per_mtok": 3.48,
  "cache_read_per_mtok": 0.145,
  "source_url": "https://opencode.ai/zen/v1/models",
  "as_of": "2026-06-29"
}
```

- Omit `cache_write_per_mtok` from the owner row; rules out adding the field unless Zen lists a distinct rate at implementation time (`computeCost` falls back to `input_per_mtok`, matching `opencode/deepseek-v4-flash-free`).
- Keep `OPENCODE_MODEL_LABELS` empty; rules out a one-off friendly attribution label.
- Pass `opencode/deepseek-v4-pro` through to `opencode run --model` unchanged; rules out a preemptive alias map without CLI evidence.

## Tasks

- [x] Add the owner price row to `data/prices.json`.
- [x] Extend `v1/test/prices.test.ts`: seed-row assertion for `opencode/deepseek-v4-pro` plus `computeCost(fixtureUsage, "opencode/deepseek-v4-pro", loadPrices())` with nonzero `cache_read_input_tokens` → `cost_source: "computed"` with non-null `cost_usd`.
- [x] Extend `v1/test/telemetry-enrichment.test.ts`: estimated opencode usage with `opencode/deepseek-v4-pro` yields `cost_source: "estimated"` and non-null `cost_usd`.
- [x] Extend `v1/test/telemetry-enrichment.test.ts`: agent-usage opencode with `opencode/deepseek-v4-pro` (usage present, `cost_usd` null) yields `cost_source: "computed"` and non-null `cost_usd`.

## Acceptance criteria

- [x] `resolveAgentPriceKey("opencode", "opencode/deepseek-v4-pro")` returns `"opencode/deepseek-v4-pro"`.
- [x] `data/prices.json` includes the owner snapshot row (`input_per_mtok` 1.74, `output_per_mtok` 3.48, `cache_read_per_mtok` 0.145, cited `source_url`, `as_of` `2026-06-29`).
- [x] `prices.test.ts` seed assertion covers `opencode/deepseek-v4-pro`; `computeCost(fixtureUsage, "opencode/deepseek-v4-pro", loadPrices())` with nonzero `cache_read_input_tokens` yields `cost_source: "computed"` with non-null `cost_usd`.
- [x] `extractUsageAndCost` with `usage_source: "estimated"`, agent `opencode`, model `opencode/deepseek-v4-pro` yields `cost_source: "estimated"` with non-null `cost_usd`.
- [x] `extractUsageAndCost` with agent-reported usage, agent `opencode`, model `opencode/deepseek-v4-pro`, and `cost_usd` null yields `cost_source: "computed"` with non-null `cost_usd`.
- [x] `config.test.ts` `"bootstraps from empty dir with defaults"` stays green.
- [ ] Live `opencode run --model opencode/deepseek-v4-pro` accepts the model. (Manual)
- [x] `bun run typecheck` passes.
- [x] `bun run test` passes.

## Documentation updates

None — registration-only opt-in; defaults and published operator workflows unchanged. No `v2/docs/v1-behaviors.md` update (net-new price row, not a change to existing default behavior).
