# Price the default codex model so cost is surfaced

## Problem

The default codex model is `gpt-5.3-codex` (`v2/docs/v1-behaviors.md` L186/L224; `modes.patch.agentOrder` default). `resolveCodexPriceKey` maps it to price key `"gpt-5.3-codex"` (`v1/src/agents/codex.ts:30`), but `data/prices.json` has no such key — only the Cursor-flavored label `"GPT-5.3 Codex"` plus `gpt-5.4`/`gpt-5.5`. So a default codex run returns `cost_source: "no-price"` and a blank cost in the run summary.

That defeats the intent's goal: a quota-offload switch to codex shows no per-run cost, so the cost decision is uninformed.

## Decisions

Add a `gpt-5.3-codex` entry to `data/prices.json` keyed exactly as `resolveCodexPriceKey` returns — rules out relying on the existing `"GPT-5.3 Codex"` Cursor label, which the codex adapter never looks up.
Entry must include `cache_read_per_mtok` strictly below `input_per_mtok` so cached tokens (after subspec 00) are discounted, matching every other priced model.
Rates and `source_url`/`as_of` come from official OpenAI gpt-5.3-codex pricing. `Deferred to first consumer: exact per-mtok rates — pin from the OpenAI pricing page at implementation time.`

## Task checklist

- [ ] Add `gpt-5.3-codex` to `data/prices.json` with input/output/cache_read rates + source_url + as_of.
- [ ] Verify a default-model codex run computes a non-null cost.
- [ ] Update docs.

## Acceptance criteria

- [ ] `data/prices.json` has a `gpt-5.3-codex` entry with `cache_read_per_mtok` < `input_per_mtok`.
- [ ] A codex run on the default model resolves `cost_source: "computed"` (not `"no-price"`) and a non-null `cost_usd`.
- [ ] `v1/test/prices.test.ts` stays green and covers the codex default price key resolving to a row.

## Documentation updates

- [ ] `v2/docs/v1-behaviors.md`: update the pricing-support entry (~L239) to record that the default codex model `gpt-5.3-codex` is priced.
