## Verdict

The diagnosis is sound and verified: codex's token mapping records OpenAI's cache-inclusive `input_tokens` alongside the cached subset, so `computeCost` bills the cached tokens twice. No blocking defects. The following refinements are required before this spec is implementation-ready.

### Required refinements

1. **Record how the intent's "surface per-agent cost" requirement is discharged.**
   The intent has three asks, not two: fix accounting *and/or* efficiency, **and** "surface effective per-run cost per agent." The spec satisfies the third implicitly (the run-summary already renders a per-agent cost column; subspecs 00/01 make it accurate and non-null), but never states this. Add one decision line — in `index.md` or 01 — recording that the existing run-summary per-agent cost table already surfaces this, and 00+01 make it accurate/non-null, so no new surfacing work is needed. Without it, a reviewer cannot tell the third ask was considered.

2. **Reframe 01's pricing rates from "deferred" to "pin at implementation," and record the source rationale.**
   The `Deferred to first consumer:` idiom is for behavior with no live caller; here the cost computation is live and needs the rate the instant the row lands, and the only correctness AC (`cache_read < input`) would pass on placeholder numbers. Change the framing to "pin from the cited OpenAI pricing page at implementation time." Additionally, record *why* the rate must come from OpenAI's official page and not the on-disk `"GPT-5.3 Codex"` Cursor row: Cursor is a reseller whose rates may be marked up/repackaged, whereas the codex adapter bills against OpenAI directly. This both fixes the framing and rules out the plausible wrong move of copying the existing Cursor row.

3. **Separate the two distinct symptoms in the index narrative.**
   The two subspecs are independent defects with different observable symptoms: 00 is over-billing on a *priced* model ($50 run, which necessarily used gpt-5.4/5.5 since the default is unpriced); 01 is *no cost at all* on the default `gpt-5.3-codex` ($0/blank). The index currently narrates them as one story and attributes the evidence run to "gpt-5.4," an inference beyond the intent's "codex/gpt-5." Reframe the index so the two symptoms ($50 double-bill vs. $0 no-price) are distinct, so each subspec's AC is validated against the correct run.

4. **Replace or drop the "order of magnitude" acceptance criterion in 00.**
   "cost drops by roughly an order of magnitude versus the pre-fix value" is not deterministically assertable and is redundant with the crisp ACs already present (`input_tokens = T − C`, clamp-to-0, and cached billed only at the cache-read rate). Either tie it to a concrete computed cost over the existing fixture or drop it.

5. **Add a one-line note that record selection stays correct on the new basis.**
   `resolveCodexSessionUsage` selects the max-total usage record; since `total_token_usage` is cumulative, subtracting cached from input preserves monotonicity and does not change selection. State this and confirm the fix lives in `extractTokenUsage` (not at the telemetry-assembly/selection layer), so an implementer does not clamp in the wrong place.

### No action required
`cache_creation_input_tokens: null` is correct (codex emits no cache-write field); `output_tokens` is out of scope; the `cost.ts` fix is correctly rejected (it is shared with Claude and correct — only the codex source over-reports); test placement across `codex.test.ts` / `codex-session.test.ts` is appropriate.