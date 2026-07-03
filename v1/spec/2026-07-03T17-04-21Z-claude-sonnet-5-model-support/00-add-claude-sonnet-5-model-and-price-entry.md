# Add claude-sonnet-5 model and price entry

Operators can pin `model: claude-sonnet-5` in a project's claude agent config and get a correctly labeled, correctly priced run. Currently only `claude-opus-4-8`, `claude-sonnet-4-6`, and `claude-haiku-4-5-20251001` resolve.

## Decisions

- `claude-sonnet-5` is a distinct opt-in model ID, not an alias target — `sonnet` keeps resolving to `claude-sonnet-4-6`, ruling out the alternative of repointing `sonnet` at the newer model.
- Price entry uses standard rate ($3.00/$15.00 per MTok), not the introductory rate through 2026-08-31 — ruling out copying a promotional price that would under-bill after the promo ends.
- No bare `sonnet-5` alias — only the full `claude-sonnet-5` ID resolves, ruling out a second short alias that would shadow future point releases.

## Task checklist

- [ ] Add `"claude-sonnet-5": "Claude Sonnet 5"` to `CLAUDE_MODEL_LABELS` in `v1/src/agents/claude.ts`.
- [ ] Add `"claude-sonnet-5": "claude-sonnet-5"` to `CLAUDE_PRICE_KEYS` in `v1/src/agents/claude.ts`.
- [ ] Add a `claude-sonnet-5` entry to `data/prices.json`: `input_per_mtok: 3.0`, `output_per_mtok: 15.0`, `cache_read_per_mtok: 0.3`, `cache_write_per_mtok: 3.75`, `source_url: "https://www.anthropic.com/pricing"`, `as_of` set to today's date.

## Acceptance criteria

- [x] `attributionLabel("claude-sonnet-5")` returns `"Claude Sonnet 5"`, and `resolveClaudePriceKey("claude-sonnet-5")` resolves a non-null price key.
- [x] `resolveClaudePriceKey("sonnet")` still returns `"claude-sonnet-4-6"` (unchanged).
- [x] `resolveClaudePriceKey("sonnet-5")` returns `null` (no bare alias added).
- [x] `bun run typecheck` and `bun run test` pass.

## Documentation updates

None — this adds a new model ID to existing lookup tables; no documented behavior changes.
