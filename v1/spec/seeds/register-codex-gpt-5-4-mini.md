# Register gpt-5.4-mini as a codex model option

The codex adapter only allows a fixed model set: `CODEX_PRICE_KEYS` in
`v1/src/agents/codex.ts` lists `gpt-5.3-codex`, `gpt-5.5`, `gpt-5.4`. A config
`agentOrder` entry naming `gpt-5.4-mini` is rejected (unknown model / no price
key), so we can't run codex on the cheaper `gpt-5.4-mini` tier — useful as a
cheap actuator and as headroom when `gpt-5.4` is quota-exhausted (the codex
pool ran dry mid-session 2026-06-27).

Add `gpt-5.4-mini` as a recognized codex model:

- Add it to `CODEX_PRICE_KEYS` (and `CODEX_MODEL_LABELS` if a friendly label is
  wanted) in `v1/src/agents/codex.ts`.
- Add a `gpt-5.4-mini` entry to `data/prices.json` with real input/output
  pricing from the OpenAI pricing page (cite `source_url` like the sibling
  `gpt-5.4`/`gpt-5.5` entries).
- Confirm the codex CLI accepts `gpt-5.4-mini` as its `--model` value (the
  adapter passes the configured model string through); if the CLI name differs,
  map it.
- Cover it in the codex price-key / config tests alongside the existing
  `gpt-5.4`/`gpt-5.5` cases.

Out of scope: changing the default `agentOrder` — registration only; the
operator opts in via `jarvis config`. Open question to resolve while
implementing: whether `gpt-5.4-mini` draws separate quota from `gpt-5.4`
(account-level limits may mean it shares the pool).
