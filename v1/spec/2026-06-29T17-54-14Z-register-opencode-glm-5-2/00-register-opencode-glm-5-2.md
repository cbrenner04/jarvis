# Register opencode/glm-5.2

`{ agent: "opencode", model: "opencode/glm-5.2" }` already round-trips config validation (`resolveOpencodePriceKey` returns the model verbatim). Without a `data/prices.json` row, harness fallback costing yields `cost_source: "no-price"` on estimated-usage enrichment and on agent-usage-without-cost enrichment. Operator opt-in: validation unchanged, `opencode run --model` receives the configured string, session usage costs against the owner price row when either fallback enrichment path runs.

## Prerequisites

- Owner-confirmed `opencode run --model opencode/glm-5.2` reachability — verified slug `opencode/glm-5.2` (`v1/docs/operator-runbook.md`, `reports/2026-06-29T04-57-44Z-operator.md`).

## Decisions

- Registration-only — do not change default `agentOrder` or `DEFAULT_AGENT_MODELS` (`config.ts:140` stays `opencode/deepseek-v4-flash-free`); rules out promoting `opencode/glm-5.2` to the bootstrapped default.
- Add only the `opencode/glm-5.2` row to `data/prices.json` with the owner snapshot and cited `source_url`; rules out implementer-invented rates and rules out a codex-style `OPENCODE_PRICE_KEYS` allowlist change (`resolveOpencodePriceKey` already passes any model string).

```json
"opencode/glm-5.2": {
  "input_per_mtok": 1.40,
  "output_per_mtok": 4.40,
  "cache_read_per_mtok": 0.26,
  "source_url": "https://opencode.ai/zen/v1/models",
  "as_of": "2026-06-28"
}
```

- Omit `cache_write_per_mtok` from the owner row; rules out adding the field unless Zen lists a distinct rate at implementation time (`computeCost` falls back to `input_per_mtok`, matching `opencode/deepseek-v4-flash-free`).
- Keep `OPENCODE_MODEL_LABELS` empty; rules out a one-off friendly attribution label.
- Pass `opencode/glm-5.2` through to `opencode run --model` unchanged; rules out a preemptive alias map without CLI evidence.
- Deferred to first consumer: automatic free-tier rotation between GLM 5.2 and DeepSeek V4 Flash Free — pin when quota-cascade intents need it.

## Tasks

- [x] Add the owner price row to `data/prices.json`.
- [x] Extend `v1/test/prices.test.ts`: seed-row assertion for `opencode/glm-5.2` plus `computeCost(fixtureUsage, "opencode/glm-5.2", loadPrices())` with nonzero `cache_read_input_tokens` → `cost_source: "computed"` with non-null `cost_usd`.
- [x] Extend `v1/test/telemetry-enrichment.test.ts`: estimated opencode usage with `opencode/glm-5.2` yields `cost_source: "estimated"` and non-null `cost_usd`.
- [x] Extend `v1/test/telemetry-enrichment.test.ts`: agent-usage opencode with `opencode/glm-5.2` (usage present, `cost_usd` null) yields `cost_source: "computed"` and non-null `cost_usd`.
- [x] Update `v1/docs/operator-runbook.md`: GLM 5.2 `prices.json` row optional to run; row enables harness cost attribution on estimated and agent-usage-without-cost fallback enrichment paths.

## Acceptance criteria

- [x] `resolveAgentPriceKey("opencode", "opencode/glm-5.2")` returns `"opencode/glm-5.2"`.
- [x] `data/prices.json` includes the owner snapshot row (`input_per_mtok` 1.40, `output_per_mtok` 4.40, `cache_read_per_mtok` 0.26, cited `source_url`, `as_of` `2026-06-28`).
- [x] `prices.test.ts` seed assertion covers `opencode/glm-5.2`; `computeCost(fixtureUsage, "opencode/glm-5.2", loadPrices())` with nonzero `cache_read_input_tokens` yields `cost_source: "computed"` with non-null `cost_usd`.
- [x] `extractUsageAndCost` with `usage_source: "estimated"`, agent `opencode`, model `opencode/glm-5.2` yields `cost_source: "estimated"` with non-null `cost_usd`.
- [x] `extractUsageAndCost` with agent-reported usage, agent `opencode`, model `opencode/glm-5.2`, and `cost_usd` null yields `cost_source: "computed"` with non-null `cost_usd`.
- [x] `v1/docs/operator-runbook.md` states GLM 5.2 `prices.json` row is optional to run and enables harness cost attribution on estimated and agent-usage-without-cost fallback enrichment paths.
- [x] `config.test.ts` `"bootstraps from empty dir with defaults"` stays green.
- [ ] Live `opencode run --model opencode/glm-5.2` accepts the model. (Manual)
- [x] `bun run typecheck` passes.
- [x] `bun run test` passes.

## Documentation updates

- `v1/docs/operator-runbook.md` — GLM 5.2 row optional to run; row enables harness cost attribution on estimated and agent-usage-without-cost fallback enrichment paths. No `v2/docs/v1-behaviors.md` update (net-new price row, not a change to existing default behavior).
