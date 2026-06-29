# Register codex gpt-5.4-mini

`agentOrder` entries `{ agent: "codex", model: "gpt-5.4-mini" }` fail config validation today because `CODEX_PRICE_KEYS` omits the model and `data/prices.json` has no row. Operator opt-in should follow the same path as `gpt-5.4` / `gpt-5.5`.

## Decisions

- Registration-only — do not change default `agentOrder`, `DEFAULT_AGENT_MODELS`, or `DEFAULT_AGENT_ORDER`; rules out promoting `gpt-5.4-mini` to the bootstrapped default.
- Add `gpt-5.4-mini` to `CODEX_PRICE_KEYS` and `data/prices.json` in the same change; rules out a prices-only row that still fails config validation.
- Price row uses the owner snapshot below with cited `source_url`; rules out implementer-invented rates.

```json
"gpt-5.4-mini": {
  "input_per_mtok": 0.75,
  "output_per_mtok": 4.5,
  "cache_read_per_mtok": 0.075,
  "source_url": "https://developers.openai.com/api/docs/models/gpt-5.4-mini",
  "as_of": "2026-06-27"
}
```

- Omit `CODEX_MODEL_LABELS` entry; rules out a one-off friendly attribution label.
- Pass the configured model string through to `codex exec --model` unchanged; rules out a preemptive alias map without CLI evidence.
- Deferred to first consumer: whether `gpt-5.4-mini` draws separate quota from `gpt-5.4` — pin when operator needs quota-tier guidance.

## Tasks

- [ ] Add `"gpt-5.4-mini": "gpt-5.4-mini"` to `CODEX_PRICE_KEYS` in `v1/src/agents/codex.ts`.
- [ ] Add the owner price row to `data/prices.json`.
- [ ] Extend `v1/test/agents/price-keys.test.ts` for `resolveAgentPriceKey("codex", "gpt-5.4-mini")`.
- [ ] Extend `v1/test/agents/codex.test.ts` to assert `--model gpt-5.4-mini` passthrough and raw `attributionLabel()`.
- [ ] Add config-validation coverage that `{ agent: "codex", model: "gpt-5.4-mini" }` loads successfully.
- [ ] Add `data/prices.json` seed assertion and cost-computation coverage for the new row (mirror `gpt-5.4` / `gpt-5.5` patterns).
- [ ] Confirm freshly bootstrapped defaults still list `codex` with `gpt-5.4`.

## Acceptance criteria

- [ ] `writeConfig` / `loadConfig` accept `{ agent: "codex", model: "gpt-5.4-mini" }` in any `modes.*.agentOrder` field validated by `validateAgentOrder`.
- [ ] `resolveAgentPriceKey("codex", "gpt-5.4-mini")` returns `"gpt-5.4-mini"`.
- [ ] `CodexAgent` with `model: "gpt-5.4-mini"` passes `--model` / `gpt-5.4-mini` to `codex exec` and `attributionLabel()` returns `gpt-5.4-mini`.
- [ ] `data/prices.json` includes the owner snapshot row (`input_per_mtok` 0.75, `output_per_mtok` 4.5, `cache_read_per_mtok` 0.075, cited `source_url`, `as_of` `2026-06-27`).
- [ ] Correlated codex session usage for `gpt-5.4-mini` yields `cost_source: "computed"` with non-null `cost_usd` (same enrichment path as `gpt-5.4`).
- [ ] Freshly bootstrapped `modes.patch.agentOrder` (and `modes.plan` / `modes.prompt`) still list `codex` with model `gpt-5.4`; no default entry references `gpt-5.4-mini`.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test` passes.

## Documentation updates

None — registration-only opt-in; defaults and published operator workflows unchanged. No `v2/docs/v1-behaviors.md` update (net-new allowlist entry, not a change to existing default behavior).
