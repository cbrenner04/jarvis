# Codex prompt-cache cost accounting

repo: https://github.com/cbrenner04/jarvis

Two independent codex cost-accounting defects with distinct symptoms:

- **00 — over-billing on a priced model ($50 run).** The codex token mapping records OpenAI's *total* `input_tokens` (inclusive of cached) alongside the cached subset, so `computeCost` bills the cached tokens at both the full-input and cache-read rate. OpenAI auto prompt-caching already credits codex (97% cache hit in the evidence run), so this is an accounting defect, not a caching inefficiency. This symptom requires a *priced* codex model (the $50.37 run used a priced gpt-5 model, since the default is unpriced — see 01).
- **01 — no cost at all on the default model ($0/blank).** The default codex model `gpt-5.3-codex` has no price-table entry, so a default codex run surfaces `cost_source: "no-price"` and a blank cost.

The intent's third ask — "surface effective per-run cost per agent" — needs no new work: the run summary already renders a per-agent cost column; 00 makes it accurate and 01 makes it non-null.

- [ ] [00 - Stop double-billing codex cached input tokens](./00-codex-cached-input-double-count.md)
- [ ] [01 - Price the default codex model so cost is surfaced](./01-default-codex-model-pricing.md)
