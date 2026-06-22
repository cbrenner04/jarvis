---
name: codex-path-cache-inefficiency
---

# Codex/gpt-5 runs don't get prompt-cache credit — ~10–25× cost blowup

## Problem

Mid-session we switched patch/plan/review to codex/gpt-5 to spare the Claude usage window. It
worked for Claude quota, but the **per-run dollar cost exploded**. The plan-git-false run on
codex reported **$50.37 with `tokens_in = 16,731,969`** (16.2M `cache_r`) for a single ~41-min
run. Comparable haiku runs cost **$0.13–5.56 with `tokens_in` of ~1k–11k** — because Anthropic
prompt caching counts the repeated context (system prompt, spec, prior iterations) as cheap
`cache_r`, leaving only the fresh delta as full-price `tokens_in`.

The codex summary puts the **full re-sent context into `tokens_in` at full input price** every
iteration — i.e. the codex path is **not getting (or not being credited for) a prompt-cache
discount**. Net: codex-via-jarvis is ~10–25× more expensive per run than it looks, which silently
undermines codex as a quota-offload fallback.

## Direction

Find out which it is and fix the one that's wrong:

- **Accounting bug?** Check whether `prices.json` / the codex cost computation applies a
  cache-read discount for codex models the way it does for Claude (cache_r priced << input). If
  codex's cached tokens are being billed at full input price in *our* math, the run isn't really
  $50 — fix the price model.
- **Real inefficiency?** If the codex CLI adapter genuinely re-sends the whole context uncached
  every iteration (no OpenAI prompt-cache / `prompt_cache_key` reuse), that's a real adapter
  problem — wire up codex's prompt caching so repeated context isn't re-billed.

Either way: **surface effective per-run cost per agent** so a quota-offload switch is an informed
cost decision, not a surprise.

## Out of scope

- Changing the agent fallback order itself — this is about cost *accuracy/efficiency* of the codex
  path, feeds [[deterministic-model-tiering-policy]].

## Evidence

- This session: codex plan-git-false run = $50.37 / 16.7M `tokens_in`; haiku runs = $0.13–5.56 /
  1–11k `tokens_in` (both with large `cache_r`). Source: run-summary stdout (`source: agent`).

## References

- `data/prices.json` (global price table); the cost computation in the run-summary path.
- `shared/invocation/` codex adapter; agent token/cache accounting.

## Prerequisites
