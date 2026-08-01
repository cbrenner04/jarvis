Verifying key code claims so the verdict is grounded in the repo.
## Verdict: refinements required

The spec is correctly scoped as one subspec and aligns with the intent. Nine gaps remain; none warrant a split. Apply these refinements before merge:

### 1. No-usage branch must precede cost computation

**Outcome:** Add a decision that `finalizeCursorInvocationResult` keeps its own absent-usage branch (`parsed.usage === undefined`) and never calls `computeCost` on that path.

**Rationale:** `computeCost` checks the price catalog before usage. An unpriced `priceKey` (e.g. existing `"composer"` fixture) plus absent usage would yield `cost_source: "no-price"` instead of `"no-usage"`, violating intent and the existing no-usage regression.

**AC fix:** Pin AC #3 to an **unpriced** `priceKey` (the existing `"composer"` binding is sufficient) so implementers cannot satisfy the criterion by swapping in a priced key.

### 2. Catalog load failure semantics

**Outcome:** Add a decision for when `loadPrices()` fails (missing, unparseable, or invalid catalog): degrade to `cost_usd: null` / `cost_source: "no-price"` rather than failing the invocation. State whether prices are loaded once (module-level) or per invocation.

**Rationale:** Wiring `loadPrices()` into finalize turns a previously infallible success path into one that can throw. The intent requires graceful cost attribution, not invocation failure on catalog problems. Using the real `data/prices.json` (no injection seam) stays correct; only failure handling needs specification.

### 3. Frame-shaped test fixture

**Outcome:** Specify that the computed-cost test declares its terminal `result` frame **locally in `agents.test.ts`** with camelCase Cursor fields (`inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`) carrying the same token counts as the Composer 2.5 fixture (4023 / 27 / 8851 / 0). Do not import `COMPOSER_25_FIXTURE_USAGE` from `cost.test.ts`.

**Rationale:** The only non-mechanical test step is frame → parsed-usage translation. Leaving it implicit invites wrong shape or cross-file coupling.

### 4. Guard-inversion mutation targets finalize, not the parser

**Outcome:** Retarget the source-mutation acceptance criterion to a finalize-branch change (e.g. routing the no-usage path through `computeCost`, or omitting the `priceKey` thread). Fold the separate “comment checkpoint” AC into this single mutation AC.

**Rationale:** Mutating `cursor-json.ts` field mapping proves arithmetic wiring that `cost.test.ts` already covers; it does not guard the new finalize branch selection. Duplicate AC framing adds review noise without extra signal.

### 5. Precision wording

**Outcome:** Replace “to the cent” with “to full precision” alongside the pinned `0.0038492` figure.

**Rationale:** The value is sub-cent; “to the cent” understates the assertion and misstates what the test pins.

### 6. Preservation ACs need test anchors

**Outcome:** Rewrite the preservation criterion to cite existing `agents.test.ts` test titles verbatim (quota classification, spawn argv, idle-timer threading, non-`ok` passthrough).

**Rationale:** Spec guidance requires refactor/preservation ACs to anchor on pinning tests, not paraphrased behavior claims.

### 7. Usage frame with all-null token fields

**Outcome:** Add a decision: when a terminal usage frame is present but all token fields are null, finalize sets `usage_source: "agent"` and delegates cost to `computeCost`, yielding `cost_source: "no-usage"`.

**Rationale:** This pairing is emergent today and defensible, but unstated it becomes an accidental contract.

### 8. Drop untestable “all-null-rate” clause

**Outcome:** Remove “or all-null-rate” from the unpriced-key decision; unknown/missing catalog row covers the unpriced path.

**Rationale:** Exercising all-null-rate rows requires injected prices, which conflicts with the intentional real-catalog coupling.

### 9. Out-of-scope clarifications

**Outcome:** Extend out-of-scope to name cost aggregation and run-summary blending of list-price cursor dollars with agent-reported spend. Correct sibling-adapter wording from “reporting `unavailable`” to adapters reporting `no-price` / `unavailable` cost (opencode, claude, codex differ).

**Rationale:** Records the semantic hazard for future aggregation work without expanding this spec. Current wording misidentifies the adapter set.

### Minor (include if touching those sections)

- One sentence acknowledging `priceKey` threads only through cursor finalize (signature asymmetry with sibling bindings is acceptable).
- `v1-behaviors.md` documentation task should cite the superseded line (~404: cursor-with-usage currently documents `cost_source: "no-price"`).