# Codex prompt-cache cost accounting

repo: https://github.com/cbrenner04/jarvis

Codex per-run cost is inflated ~10–25× because the codex token mapping records OpenAI's *total* `input_tokens` (inclusive of cached) alongside the cached subset, so `computeCost` bills the cached tokens at both the full-input and cache-read rate. OpenAI auto prompt-caching already credits codex (97% cache hit in the $50.37 evidence run), so this is an accounting defect, not a caching inefficiency. Separately, the default codex model has no price-table entry, so default codex runs surface no cost at all.

- [ ] [00 - Stop double-billing codex cached input tokens](./00-codex-cached-input-double-count.md)
- [ ] [01 - Price the default codex model so cost is surfaced](./01-default-codex-model-pricing.md)
