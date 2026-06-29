## Verdict: Refine before merge

Implementation satisfies the primary immutable-only overreach path, exclusions (invalid blocker composite, no successful pass on mixed failure), notice contract, shared helper wiring, and most docs. Two gaps need closure before merge.

### Required outcomes

1. **Fix operator-runbook recovery timing.** `v1/docs/operator-runbook.md` transient-killed plan guidance says recovery happens on the “next successful actuator pass.” Recovery runs in the **same** plan review invocation—immediately after `runVerdictActuator`, before commit or `commit: false` phase return—when post-actuator validation fails only because registered immutable copies drifted. Update the runbook so operators are not told to wait for or depend on a later pass for this auto-recovery.

2. **Lock and document mixed-failure worktree semantics.** When immutable-copy drift coexists with another `validateReviewOutput` failure, the pass correctly hard-fails with no recovery notice and no commit/phase success. However, the helper still snapshot-reverts drifted registered copies before re-validation to classify eligibility (per the spec’s snapshot-diff classifier, not error-string parsing). That leaves `intent.md` reverted while other failures (e.g. missing `index.md`) and allowed subspec edits may remain—a worktree state docs currently describe as “recovery does not run,” which operators can read as no revert at all.

   **Must be true after fix:**
   - `plan-mode.md` (and `v2/docs/v1-behaviors.md` if its mixed-failure wording is equally ambiguous) explicitly states what remains on disk after a mixed-failure hard-fail, including whether reverted immutable copies are restored as a classification side effect.
   - Unit and plan-review integration tests assert post-failure on-disk state for mixed-failure scenarios (at minimum: whether `intent.md` is snapshot-reverted when re-validation still fails), so the chosen contract cannot drift silently.

   **Rationale:** Acceptance criteria require mixed failure to “not recover” and keep “current error behavior” from the operator’s perspective on outcomes (fail, no notice, no commit). Without an explicit, tested worktree contract, revert-then-revalidate classification conflicts with doc phrasing and risks surprising operators who expect a fully dirty failure tree or who manually reconcile against the wrong `intent.md` state.

### Not required

- `intent.md` deletion throwing inside `validateReviewOutput` — pre-existing; out of this slice.
- Recovery notice before `assertPlanWriteBoundary` on `commit: true` — spec separates validation recovery from boundary hard-fail; defensible as-is.
- Pinned `intent.md` fallout detection, patch empty-registry hook, fallout substring false positives — in spec for v1.
- `commit: true` fallout assertion — helper path covered elsewhere; optional polish only.
