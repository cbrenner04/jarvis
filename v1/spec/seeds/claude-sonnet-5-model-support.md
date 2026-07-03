# Claude Sonnet 5 model support

Add Claude Sonnet 5 support to the claude agent.

`v1/src/agents/claude.ts` has no entry for `claude-sonnet-5` in
`CLAUDE_MODEL_LABELS` or `CLAUDE_PRICE_KEYS` — only `claude-sonnet-4-6` is
mapped (including the `sonnet` alias, which should keep resolving to
`claude-sonnet-4-6` since that's still a supported model). `data/prices.json`
has no `claude-sonnet-5` entry either.

Add:
- `CLAUDE_MODEL_LABELS["claude-sonnet-5"] = "Claude Sonnet 5"`
- `CLAUDE_PRICE_KEYS["claude-sonnet-5"] = "claude-sonnet-5"`
- a `claude-sonnet-5` entry in `data/prices.json` under `models`: input
  $3.00/MTok, output $15.00/MTok (standard rate, not the introductory
  $2.00/$10.00 pricing through 2026-08-31 — this data is for cost
  estimation only, and using the standard rate avoids a follow-up update
  when the intro window ends), cache_read/cache_write scaled the same as
  the existing `claude-sonnet-4-6` entry (0.1x input for read, 1.25x input
  for write). Source: <https://www.anthropic.com/pricing>, as_of today's
  date.

Do not add a `sonnet-5` bare alias to `CLAUDE_PRICE_KEYS`/model-resolution —
only the full `claude-sonnet-5` ID needs to work when passed explicitly via
config (`{"agent": "claude", "model": "claude-sonnet-5"}`).
