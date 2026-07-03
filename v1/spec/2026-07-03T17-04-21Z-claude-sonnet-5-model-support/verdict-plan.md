Verdict: refine, no blocking issues.

**Upheld: AC1 should cite `attributionLabel()` by name.**
The task checklist edits `CLAUDE_MODEL_LABELS`, and `attributionLabel()` in `v1/src/agents/claude.ts` is the sole consumer that surfaces this map as the "label" behavior AC1 describes. The repo's existing test convention already covers this exact shape (`attributionLabel returns mapped label for known model ID`). AC1 currently says only "reports the label 'Claude Sonnet 5'" without naming the method, which lets an implementer satisfy it with a looser integration check instead of mirroring the direct, cheap unit-test precedent. Per spec-guidance's citation principle for behavior with a direct existing-test analog, AC1 should name `attributionLabel()` explicitly.

**Not upheld: no change needed to `price-keys.ts`.**
That file is a pure dispatcher with no per-model list; `resolveClaudePriceKey` already flows through it unchanged. The intent's stated plumbing surface (`CLAUDE_MODEL_LABELS`/`CLAUDE_PRICE_KEYS` in `claude.ts` plus the `data/prices.json` entry) is complete. Adding a `price-keys.ts` task would be unscoped churn.

**Required refinement:** tighten AC1 in `00-add-claude-sonnet-5-model-and-price-entry.md` to name `attributionLabel()` as the function under test, consistent with the checklist's edit to `CLAUDE_MODEL_LABELS`. No other changes to the spec are required.