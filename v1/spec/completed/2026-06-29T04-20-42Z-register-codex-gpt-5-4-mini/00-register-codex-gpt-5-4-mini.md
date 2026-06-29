# Register codex gpt-5.4-mini

`agentOrder` entries `{ agent: "codex", model: "gpt-5.4-mini" }` fail config validation today because `CODEX_PRICE_KEYS` omits `gpt-5.4-mini` (`validateAgentOrder` → `resolveAgentPriceKey` → `null`). A missing `data/prices.json` row does not block `loadConfig` / `writeConfig`; it breaks priced cost attribution (`cost_source: "no-price"`). Operator opt-in should follow the same path as `gpt-5.4` / `gpt-5.5` (validation + priced runs).

## Prerequisites

- Owner-confirmed `codex exec` CLI reachability for `gpt-5.4-mini` (or the verified slug if different). If slug ≠ `gpt-5.4-mini`, record it below and adjust passthrough expectations before merge.

## Decisions

- Registration-only — do not change default `agentOrder`, `DEFAULT_AGENT_MODELS`, or `DEFAULT_AGENT_ORDER`; rules out promoting `gpt-5.4-mini` to the bootstrapped default.
- Add `gpt-5.4-mini` to `CODEX_PRICE_KEYS` and `data/prices.json` in the same change; rules out shipping only one half of the opt-in path (validation without priced runs, or priced row without validation).
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
- Pass the configured model string through to `codex exec --model` per verified CLI slug from Prerequisites; rules out a preemptive alias map without CLI evidence.
- Deferred to first consumer: whether `gpt-5.4-mini` draws separate quota from `gpt-5.4` — pin when operator needs quota-tier guidance.

## Tasks

- [ ] Add `"gpt-5.4-mini": "gpt-5.4-mini"` to `CODEX_PRICE_KEYS` in `v1/src/agents/codex.ts`.
- [ ] Add the owner price row to `data/prices.json`.
- [ ] Extend `v1/test/agents/price-keys.test.ts` for `resolveAgentPriceKey("codex", "gpt-5.4-mini")`.
- [ ] Extend `v1/test/agents/codex.test.ts` to assert `--model` passthrough (verified slug) and raw `attributionLabel()`.
- [ ] Add config-validation coverage: `{ agent: "codex", model: "gpt-5.4-mini" }` round-trips via `writeConfig` / `loadConfig` on a representative `agentOrder` field (e.g. `modes.patch.agentOrder`).
- [ ] Extend `v1/test/prices.test.ts`: seed-row assertion for `gpt-5.4-mini` (mirror `"checked-in seed data includes the default Codex model"`) plus `computeCost(fixtureUsage, "gpt-5.4-mini", loadPrices())` → `cost_source: "computed"` with non-null `cost_usd`.

## Acceptance criteria

- [x] `writeConfig` / `loadConfig` accept `{ agent: "codex", model: "gpt-5.4-mini" }` in a representative `agentOrder` field exercised by `validateAgentOrder` (e.g. `modes.patch.agentOrder`).
- [x] `resolveAgentPriceKey("codex", "gpt-5.4-mini")` returns `"gpt-5.4-mini"`.
- [x] `CodexAgent` with `model: "gpt-5.4-mini"` passes the verified CLI slug to `codex exec --model` and `attributionLabel()` returns the raw model string.
- [x] `data/prices.json` includes the owner snapshot row (`input_per_mtok` 0.75, `output_per_mtok` 4.5, `cache_read_per_mtok` 0.075, cited `source_url`, `as_of` `2026-06-27`).
- [x] `prices.test.ts` seed assertion covers `gpt-5.4-mini`; `computeCost(fixtureUsage, "gpt-5.4-mini", loadPrices())` yields `cost_source: "computed"` with non-null `cost_usd`.
- [x] `config.test.ts` `"bootstraps from empty dir with defaults"` stays green.
- [ ] Live `codex exec --model <verified slug>` accepts the model. (Manual)
- [x] `bun run typecheck` passes.
- [x] `bun run test` passes.

## Documentation updates

None — registration-only opt-in; defaults and published operator workflows unchanged. No `v2/docs/v1-behaviors.md` update (net-new allowlist entry, not a change to existing default behavior).
