Both upheld findings confirmed against the code. Here is the verdict.

## Verdict

Two comment-accuracy defects must be fixed before merge. Neither alters behavior; both are inconsistencies between code comments and the governing spec decisions, which mislead future readers about decisions the spec deliberately pinned.

### Required outcomes

1. **Correct the baseline-gate-red rationale comment in `review.ts` (the `return 1` site after a failed review baseline gate, ~lines 774–779).** The comment currently asserts this path is "unreachable on the completion path — a backstop for non-completion paths" and cites stale cross-file line references (`run.ts:1574`, `run.ts:1601`) that no longer point at the relevant logic (the completion gate and stuck-red exit-10 path now live in `completion-pipeline.ts`). This directly contradicts the spec's own decision, which rules out treating baseline-gate-red as an unreachable backstop *because it is reachable via `--resume-review`* (in scope), and justifies the preserved `return 1` as "a red tree is a real error regardless of how review was entered." The comment must be rewritten to that resume-reachable / red-tree-is-a-real-error framing and must not carry hard-coded, now-incorrect line references. The `return 1` behavior itself is correct and stays.

2. **Document the `11` sentinel in the `RESERVED_REVIEW_EXIT_CODES` comment (`review/run.ts`, ~lines 10–14).** `11` was added to the reserved set per an explicit spec decision (so a reviewer agent CLI that coincidentally exits `11` collapses to `1` and cannot impersonate the `review-incomplete` sentinel), but the explanatory comment still enumerates only `2`, `3`, `7`, `130`. A reader finding `11` in the set with no rationale has an unexplained gap. Add a clause noting `11` is the `review-incomplete` harness sentinel.

### Not upheld

The concern that the `mapReviewExitCode` helper constitutes a caller-side or near-blanket classifier is rejected. The helper lives inside the review phase itself; the caller (`completion-pipeline.ts`) still propagates the integer unchanged, preserving the contract the spec required. The two gate-red paths (`return 1`) and the committed-blocker path (`return 7`) return directly and bypass the helper, so only the review-*execution* failure sites flow through it — exactly the set the spec says must yield `11`. This is "discriminated at the source," cleanly factored, not the ruled-out "any non-zero review exit → review-incomplete" blanket. No change required.