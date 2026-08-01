# Verdict

Upheld — the spec needs these outcomes covered. All fit inside the single existing subspec; the split question is settled (one module, one function, one return type — do not split).

1. **Usage selection must be stated as independent of display-text selection, and pinned by a test.**
   The parser today does `lastResultText = typeof frame.result === "string" ? frame.result : null` (`shared/invocation/cursor-json.ts:33`) and falls back to concatenated text-delta frames when no result string was found. Usage lives on the same frame but is not gated by whether `result` is a usable string. The natural implementation — threading usage through the existing result-text branch — silently drops usage whenever the terminal frame's `result` is absent or non-string. Add a decision saying the two selections are independent, and an acceptance criterion whose fixture has a terminal `result` frame with `usage` but no usable `result` string: `displayText` comes from the text-delta fallback *and* `usage` is still returned.

2. **"Last result frame wins" needs an acceptance criterion, not just a decision and a task.**
   The subspec states it twice in non-binding sections and never grades it. The discriminating fixture is two result frames where the *first* carries `usage` and the *last* carries none — the result must omit `usage` (stale usage must not leak forward). Without this AC the rule is unenforced.

3. **The `usage`-present-but-unmeasured shape must be decided and graded.**
   The subspec adds per-field `number | null` coercion (matching `claude-json.ts` `extractUsage`) beyond the intent's decisions. That coercion is right, but it reintroduces the all-null object the intent's third decision was written to prevent — for `usage: {}` or a partially-populated frame. Say so explicitly and grade it: `usage: {}` and partial objects yield a *present* `usage` object with `null` for missing fields, and `usage` present is not itself evidence of measurement.

4. **Record the outer return contract for the downstream consumer.**
   A sibling spec (`cursor-invocation-records-agent-usage`) will mirror claude's `parsed.usage !== null` check, which for this shape becomes `!== undefined` and would stamp agent-measured provenance onto an all-null object. One decision line stating the contract — absent `usage` means no measurement; present-but-all-null is possible and is also not a measurement — belongs in this spec because it is this parser's own return contract.

5. **Two wording tightenings.**
   - "no `usage` object" should read as absent, `null`, or non-object (arrays included), matching `extractUsage`'s rejection set.
   - The "matches `claude-json.ts` `extractUsage`" claim should be scoped to per-field coercion only. Claude's contract is `usage: … | null`, always present; this one is `usage?: …`, omitted. The unqualified claim is what would lead the sibling to copy the wrong null-check shape.

6. **The mapped-usage fixture must include a zero count.**
   Cursor emits `0` for cache-write on real runs. A `typeof x === "number"` mapping handles it, but nothing currently pins it against a falsy-check regression that would coerce `0` to `null`. Requiring one `0` in the mapped-usage AC's fixture closes this at no cost.

Declined — no refinement needed:

- Guard-inversion ACs need not name test titles; naming the source mutation, as ACs 3–4 already do, satisfies the requirement, and inventing titles pins incidental naming.
- Cursor's `usage` wire shape is not a prerequisite: the Prerequisites gate checks behavior observable in committed code, and this spec's tests *become* that committed fixture. Citing the verified frame in the subspec body is optional.
- `cursor-json.test.ts` stays green` is an adequate preservation AC; the subspec title is fine.