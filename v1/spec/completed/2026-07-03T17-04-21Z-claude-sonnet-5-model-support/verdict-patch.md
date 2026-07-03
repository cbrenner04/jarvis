Required outcome:

- Add test coverage in `v1/test/agents/claude.test.ts` asserting `attributionLabel("claude-sonnet-5")` returns `"Claude Sonnet 5"` and `resolveClaudePriceKey("claude-sonnet-5")` resolves a non-null price key, plus `resolveClaudePriceKey("sonnet-5")` returns `null`. Follow the existing test pattern already used for `attributionLabel` (known/unknown/default-fallback cases).

Rationale: AC1–AC3 assert specific function-return behavior for the new model ID, but the branch diff touches only `claude.ts` and `data/prices.json` — no test file. Without a test, correctness is verified only by hand-inspection, and a future edit to `CLAUDE_MODEL_LABELS`/`CLAUDE_PRICE_KEYS` could silently break `claude-sonnet-5` resolution with no CI signal to catch it.