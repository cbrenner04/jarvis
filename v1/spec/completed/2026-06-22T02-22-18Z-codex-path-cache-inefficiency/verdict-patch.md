## Verdict

The implementation fix is correct, minimal, and the docs are accurate — the clamp, `cache_creation_input_tokens: null`, the "fix the codex source not `cost.ts`" rationale, and selection-monotonicity invariance all hold. One upheld issue requires action; it concerns the test/spec audit trail, not shipped behavior.

### Upheld issue: the cost assertion does not exercise the record the pipeline actually bills

The spec's example figures (`input_tokens: 53251`, `cached_input_tokens: 50048`) are the per-iteration `last_token_usage` field, which the code never reads. The pipeline selects the cumulative `total_token_usage` record, which for this fixture yields fresh `36475` / cache_read `606720`. Consequences:

- AC3 states `computeCost` is exercised "over the fixture usage (input_tokens: 53251, cached_input_tokens: 50048)," but those numbers are not what the fixture produces through the pipeline. The cost test hardcodes synthetic values (`3203 / 50048 / 248`) derived from the unread field, so it is a unit test of `computeCost`'s disjoint-bucket convention — which was already correct pre-fix — rather than a guard over real pipeline output. The actual normalization regression is guarded only indirectly, by the parse test asserting `36475`.

### Required outcome

- Add an assertion that threads the **real fixture** through the consumed path — `parseCodexSessionUsage`/`extractTokenUsage` output piped into `computeCost` — and verifies the cached subset is billed only at the cache-read rate, not the input rate, over the record the pipeline actually selects (`36475` fresh / `606720` cache_read). This closes the traceability gap so the end-to-end billing guard is explicit in one test and tied to the record that drives cost, rather than split across a normalization assertion and a synthetic-object cost assertion. Keep the existing parse and cost tests green.

If the actuator is permitted to touch subspec `00` (not `index.md`), correct AC3 and the Problem section's example numbers to the `total_token_usage`-derived figures so the spec describes the record the code bills; if the spec tree is frozen, the test outcome above is sufficient and the spec-prose correction is not required.