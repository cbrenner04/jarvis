# Register opencode/glm-5.2

`{ agent: "opencode", model: "opencode/glm-5.2" }` already round-trips config validation (`resolveOpencodePriceKey` returns the model verbatim). Without a `data/prices.json` row, estimated-usage enrichment yields `cost_source: "no-price"`. Operator opt-in: validation unchanged, `opencode run --model` receives the configured string, session usage costs against the owner price row when the estimator path runs.

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

- Keep `OPENCODE_MODEL_LABELS` empty; rules out a one-off friendly attribution label.
- Pass `opencode/glm-5.2` through to `opencode run --model` unchanged; rules out a preemptive alias map without CLI evidence.
- Deferred to first consumer: automatic free-tier rotation between GLM 5.2 and DeepSeek V4 Flash Free — pin when quota-cascade intents need it.

## Tasks

- [ ] Add the owner price row to `data/prices.json`.
- [ ] Extend `v1/test/prices.test.ts`: seed-row assertion for `opencode/glm-5.2` plus `computeCost(fixtureUsage, "opencode/glm-5.2", loadPrices())` → `cost_source: "computed"` with non-null `cost_usd`.
- [ ] Extend `v1/test/telemetry-enrichment.test.ts`: estimated opencode usage with `opencode/glm-5.2` yields `cost_source: "estimated"` and non-null `cost_usd`.
- [ ] Extend `v1/test/agents/opencode.test.ts`: assert `--model` passthrough for `opencode/glm-5.2` and raw `attributionLabel()`.
- [ ] Add config-validation coverage: `{ agent: "opencode", model: "opencode/glm-5.2" }` round-trips via `writeConfig` / `loadConfig` on `modes.patch.agentOrder`.

## Acceptance criteria

- [ ] `writeConfig` / `loadConfig` accept `{ agent: "opencode", model: "opencode/glm-5.2" }` in `modes.patch.agentOrder`.
- [ ] `resolveAgentPriceKey("opencode", "opencode/glm-5.2")` returns `"opencode/glm-5.2"`.
- [ ] `OpencodeAgent` with `model: "opencode/glm-5.2"` passes `opencode/glm-5.2` to `opencode run --model` and `attributionLabel()` returns the raw model string.
- [ ] `data/prices.json` includes the owner snapshot row (`input_per_mtok` 1.40, `output_per_mtok` 4.40, `cache_read_per_mtok` 0.26, cited `source_url`, `as_of` `2026-06-28`).
- [ ] `prices.test.ts` seed assertion covers `opencode/glm-5.2`; `computeCost(fixtureUsage, "opencode/glm-5.2", loadPrices())` yields `cost_source: "computed"` with non-null `cost_usd`.
- [ ] `extractUsageAndCost` with `usage_source: "estimated"`, agent `opencode`, model `opencode/glm-5.2` yields `cost_source: "estimated"` with non-null `cost_usd`.
- [ ] `config.test.ts` `"bootstraps from empty dir with defaults"` stays green.
- [ ] Live `opencode run --model opencode/glm-5.2` accepts the model. (Manual)
- [ ] `bun run typecheck` passes.
- [ ] `bun run test` passes.

## Documentation updates

None — registration-only opt-in; defaults and published operator workflows unchanged. No `v2/docs/v1-behaviors.md` update (net-new price row, not a change to existing default behavior).
