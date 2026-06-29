## Verdict: required outcomes

1. **Operator migration framing in durable docs**  
   `v1/docs/operator-runbook.md` (**The gate**) and `v2/docs/v1-behaviors.md` must explicitly state the prior contract and the deliberate change: on `full` tier, green verification with non-empty porcelain used to abort immediately with `ReadyVerificationDirtyError`; it now auto-commits harness-owned churn (`chore: apply post-ready verification output`) before proceeding.  
   **Why:** Spec decision ledger and acceptance criteria require an observable operator expectation shift for repos that treated green+dirty as an abort signal. Current docs describe only the new norm.

2. **Residual still-dirty error message must match the pinned template**  
   When porcelain remains non-empty after a successful post-verification commit attempt, `ReadyVerificationDirtyError` must follow the same structure as pre-ready residual dirt: commit succeeded, worktree still dirty, do not call `gh pr ready`, inspect unexpected changes (not guidance to fold autofix into `readyCommand`). The opening clause must convey that a post-verification commit was attempted and succeeded, analogous to pre-ready’s “pre-ready fix commit succeeded but worktree is still dirty”.  
   **Why:** Spec AC #5 and decision ledger pin parity with the pre-ready still-dirty template. Current message opens with “verification returned green” and omits the commit-attempted beat; the still-dirty unit test encodes the weaker wording.

3. **Tests must assert the corrected residual-dirty contract**  
   `ready-gate.test.ts` (and any other test that pins this message) must expect the updated template, not the pre-fix wording.  
   **Why:** Message shape is part of the operator-facing contract; tests that bake in the old text would allow regression.

---

**No other action required.** Core gate behavior, error classification, recorded-green timing, shared-helper inheritance, doc-only exit-6 dirty-worktree exclusion, fast-tier preservation, and primary mutating-`readyCommand` success path meet the spec. Optional test-depth gaps (completion-path post-verify failure integration, fast-tier `commitPostVerification` spy, real-git residual-dirt path) are not blocking.
