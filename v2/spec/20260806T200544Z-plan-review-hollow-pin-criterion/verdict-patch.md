Reviewing the implementation against the spec and adjudicator refinements to issue a focused verdict.
# Adjudicator verdict: plan review hollow-pin criterion

## Required outcomes

1. **`bun run test:v2` and `bun run test:integration:v2` must pass before this work is treated as complete.** The branch refactors `v2/src/execution/mutation-checkpoint-verifier.ts` to consume the shared `selectMutationCheckpointCriteria` helper. Repo CI scope rules union both v2 test scripts for any `v2/**` touch, but the subspec acceptance criteria only require `typecheck`, `test:shared`, and `test:v1`. The extraction is intended to be shape-preserving (`block` and `firstLine` map to the prior `block` and `criterion.text`), yet the verifier is the implement-time hard gate for mutation checkpoints — its regression suite is the authoritative check that shared selection did not drift. Run both v2 scripts; if either fails, fix the verifier integration before merge.

## Rationale

All spec-contract behavior appears implemented: advisory hollow-pin detection and `## At-risk hollow pins` injection into plan debate `REVIEW_PASS_CONTEXT`, bounded scan scope (top-level staged `.md` minus `index.md`/`intent.md`, human-only skip, directive-shaped selection), shared criterion parsing extracted from the verifier, adversary reporting instruction with snapshot bump, mutation checkpoint in the named test, and extension hooks (`buildPlanReviewPassContext`, `formatAtRiskHollowPinsSection`) for same-seam sibling composition.

Documented heuristic limits (unquoted pin-title substrings still flagged, unrelated backtick/quote tokens clear the advisory check, `.test.` substring edge case in pin titles) are spec-accepted tradeoffs for an advisory pass, not linker parity — no code change required.

No other findings rise to actuator action. Heuristic hardening, stable multi-file finding order, and adjudicator-role test coverage are optional polish, not contract gaps.