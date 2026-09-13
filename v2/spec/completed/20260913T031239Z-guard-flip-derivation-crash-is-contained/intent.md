---
name: guard-flip-derivation-crash-is-contained
---

# Guard-flip derivation slices `!expr.call(...)` correctly and an unappliable candidate never fails the run

Guard-flip mutation-candidate derivation in `v2/src/execution/diff-derived-mutation-verifier.ts` (`deriveGuardMutations`, reached via `deriveFromLine`) is regex-based (`/(!\s*[a-zA-Z_][a-zA-Z0-9_]*|!(?:\([^)]+\)))/g`) and mis-slices a negated method call: on `if (!CONSUMER_FILES.has(file) || …)` it derives `guard-flip: !CONSUMER_FILES → CONSUMER_FILES` instead of targeting `!CONSUMER_FILES.has(file)`. `applyMutation`'s slice-verify then rejects the span, and on the evidenced run (`da6ec4b9`, 2026-08-30) `testCandidate` rethrew `Failed to test candidate for scripts/guard-lossless-git-status-inventory.ts:57`, settling the write loop at `run_execution_failed` / `invocation_error` / `retryable: false` / `nextAction: stop` — a code-complete implement lost non-resumably.

Two behaviors, one surface:

- Guard-flip derivation targets the whole negated boolean sub-expression, including member/call chains, with an `originalText` that slice-verifies — via the same TypeScript-scanner classification #3202 used for operator-flip, not a widened regex. Operator-flip, destructive-family derivation, and killing-test/render-coverage resolution are unchanged and out of scope — destructive-family's regex only matches a call name plus `(`, with no evidenced member/call-chain mis-slice.
- No unappliable candidate can terminate the run. `applyMutation` already throws `UnappliableMutationError` for slice-verify mismatch and `testCandidate` catches it into a skip/diagnostic result, so establish whether that containment covers every apply/test site reachable on the base; any path that still reaches the `Failed to test candidate` rethrow must be converted to a contained skip or derivation diagnostic.

Unsplit rationale: both defects live entirely inside the diff-derived mutation verifier module (derivation and its own `testCandidate` failure path) with no other module-boundary surface changing — `write-loop.ts` only consumes the returned `VerificationResult` — so per the module-boundary split rule there is exactly one surface to split on.

## Primary implementation surface

- `v2/src/execution/diff-derived-mutation-verifier.ts`

## Prerequisites

- Operator-flip mutation-candidate derivation already classifies via the TypeScript scanner (#3202), so guard-flip can reuse that classification.
- `applyMutation` raises a distinguishable unappliable-mutation error on slice-verify mismatch.

## Notes

Docs: `v2/docs/operator-runbook.md` (Gate trust / mutation verification) already documents containment as landed — a mis-derived candidate is skipped (`PassResult.skippedCandidates`), not a crash — and cross-references this intent by name as tracking the residual slice bug. Once the slice fix lands, update or remove that cross-reference to reflect the resolved state.
