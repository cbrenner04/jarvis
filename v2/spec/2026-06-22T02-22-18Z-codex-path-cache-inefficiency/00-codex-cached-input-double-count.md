# Stop double-billing codex cached input tokens

## Problem

`computeCost` (`v1/src/prices/cost.ts`) bills `input_tokens` and `cache_read_input_tokens` as **disjoint** buckets: `input_tokens*input_rate + cache_read*cache_read_rate`. The Claude adapter satisfies this — Anthropic reports `input_tokens` exclusive of cache reads.

Codex does not. `extractTokenUsage` (`v1/src/agents/codex-session.ts:380-389`) records OpenAI's `total_token_usage.input_tokens` (which is **inclusive** of `cached_input_tokens`) as `input_tokens`, and the cached subset as `cache_read_input_tokens`. The cached tokens are then billed twice: once at the full input rate (inside `input_tokens`) and again at the cache-read rate. Fixture `v1/test/fixtures/codex/0.130.0-session.jsonl` shows `input_tokens: 53251`, `cached_input_tokens: 50048` — 50048 tokens double-counted.

Evidence run (a priced gpt-5 model — the $50 symptom requires one, since the default is unpriced): $50.37 / 16.7M `tokens_in` (16.2M `cache_r`). Correcting to fresh-only input (~0.5M) drops it to the ~$5 range of comparable runs.

## Decisions

Record `input_tokens` as fresh (non-cached) tokens only: `max(0, input - cached)` — matches the disjoint-bucket convention `cost.ts` already assumes; clamp guards malformed records where cached > input.
Fix lives in the codex token mapping, not `cost.ts` — `cost.ts` is correct and shared with Claude; only the codex source over-reports.
Do not wire OpenAI `prompt_cache_key`/caching — the evidence run shows ~97% cache hit, so caching already works; the defect is purely accounting (rules out the intent's "real inefficiency" branch).
`cache_creation_input_tokens` stays `null` — codex reports no cache-write field.
Clamp in `extractTokenUsage`, not `resolveCodexSessionUsage`: that selector picks the max-total record, and since `total_token_usage` is cumulative, subtracting cached from input preserves monotonicity and does not change selection — clamping at the selection/telemetry-assembly layer would be the wrong place.

## Task checklist

- [ ] Subtract cached from input in `extractTokenUsage` (clamped at 0).
- [ ] Update `v1/test/codex-session.test.ts` expectations to fresh-only `input_tokens`.
- [ ] Add a cost assertion: a codex usage record with cached < input does not bill the cached tokens at the input rate.
- [ ] Update docs.

## Acceptance criteria

- [x] For a codex session reporting `input_tokens: T` and `cached_input_tokens: C` (C ≤ T), recorded telemetry has `input_tokens = T - C` and `cache_read_input_tokens = C`.
- [x] When `cached_input_tokens > input_tokens` (malformed), recorded `input_tokens` is `0`, never negative.
- [x] `computeCost` over the fixture usage (`input_tokens: 53251`, `cached_input_tokens: 50048`) charges the 50048 cached tokens only at the cache-read rate, not the input rate — i.e. cost equals `3203*input_rate + 50048*cache_read_rate`, not `53251*input_rate + 50048*cache_read_rate`.
- [x] `v1/test/codex-session.test.ts` is updated to assert fresh-only `input_tokens` and stays green.
- [x] `v1/test/agents/codex.test.ts` stays green.

## Documentation updates

- [x] `v2/docs/v1-behaviors.md`: update the codex usage/cost entry (currently ~L231/L240) to record that codex `input_tokens` is normalized to fresh-only (cached subtracted) before costing.
- [x] `v1/docs/agents.md`: note the codex cached-token normalization where codex usage/cost is described.
