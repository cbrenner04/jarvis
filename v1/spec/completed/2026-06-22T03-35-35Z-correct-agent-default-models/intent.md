---
name: correct-agent-default-models
---

# Correct stale agent default models (codex, cursor)

## Problem

`DEFAULT_AGENT_MODELS` (`v1/src/config.ts:126`) has two stale defaults:

- **`codex: "gpt-5.3-codex"`** — OpenAI pulled subscription access to `gpt-5.3-codex`, so the codex/OpenAI adapter can no longer reach it; and there is no price entry for it (`resolveCodexPriceKey` → `"gpt-5.3-codex"`, absent from `data/prices.json` → `no-price`). So codex-as-fallback defaults to an **unreachable, unpriced** model.
- **`cursor: "Composer 2"`** — `Composer 2.5` is a strictly better model at **identical price** (both `input 0.5 / output 2.5` per mtok in `data/prices.json`). No reason to default to 2.

## Direction

- **codex default → `gpt-5.4`** (reachable + already priced). `gpt-5.3-codex` is now cursor-only — its Cursor `GPT-5.3 Codex` price row stays; do **not** add a codex/OpenAI `gpt-5.3-codex` entry.
- **cursor default → `Composer 2.5`**. (Quirk to be aware of: `cursor.ts` already maps the *price key* `Composer 2 → composer-2.5`, but the requested model *string* is still `Composer 2` — changing the default string is what actually switches the model used.)

## Out of scope

- The cheap-tier ordering / declared-tier policy (`claude:haiku → cursor:gpt-5.3-codex`, escalate-on-failure) — that's [[deterministic-model-tiering-policy]]. This is only the two stale-default corrections.
- Pricing `gpt-5.3-codex` for codex — dropped; it's cursor-only.

## Documentation updates

- `v2/docs/v1-behaviors.md` / `v1/docs/agents.md` — record the corrected codex (`gpt-5.4`) and cursor (`Composer 2.5`) defaults.

## References

- `v1/src/config.ts:126` (`DEFAULT_AGENT_MODELS`); `data/prices.json` (Composer 2/2.5 same rate; `gpt-5.4` priced); `v1/src/agents/codex.ts` (`resolveCodexPriceKey`); `v1/src/agents/cursor.ts` (price-key map quirk).
- See [[gpt-5.3-codex-cheap-tier-via-cursor]].

## Prerequisites
