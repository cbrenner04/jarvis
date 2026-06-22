# Codex prompt-cache cost accounting

repo: https://github.com/cbrenner04/jarvis

The codex token mapping records OpenAI's *total* `input_tokens` (inclusive of cached) alongside the cached subset, so `computeCost` bills the cached tokens at **both** the full-input and cache-read rate — the $50.37 evidence run (16.2M `cache_r`, ~97% hit). OpenAI auto prompt-caching already credits codex, so this is an accounting defect, not a caching inefficiency. Correcting to fresh-only input drops the run to the ~$5 range.

The intent's "surface effective per-run cost per agent" ask needs no new work: the run summary already renders a per-agent cost column; 00 makes it accurate.

**Dropped: 01 — price the default codex model.** `gpt-5.3-codex`'s OpenAI subscription access was pulled, so it's reached via the **cursor** agent (whose `GPT-5.3 Codex` price row already exists), not the codex/OpenAI adapter. Pricing a codex/OpenAI default that can no longer reach the model is moot, and the cheap-tier model selection (haiku → `cursor:gpt-5.3-codex`) belongs to the model-tiering work — folded into `deterministic-model-tiering-policy`.

- [ ] [00 - Stop double-billing codex cached input tokens](./00-codex-cached-input-double-count.md)
