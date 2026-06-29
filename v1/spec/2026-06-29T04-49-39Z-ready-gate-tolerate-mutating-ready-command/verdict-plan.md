## Verdict: required refinements

1. **Supersede prior gate invariant explicitly.** The spec reverses `2026-06-27T22-03-04Z-jarvis-fix-commit-ready-order-2` (“green full-tier verification never commits dirty output after `ready` returns”). The decision ledger must name that supersession so reviewers see a deliberate reversal, not an accidental contradiction. Doc ACs already task updates; the ledger must state what replaces the old contract.

2. **Redefine “unexpected post-verification dirt.”** Intent #2 (“unexpected dirt still aborts”) conflicts with commit-all on green+dirty porcelain. The ledger must pin: committable post-verify dirt is harness-owned and committed; abort applies only to **residual porcelain after the post-verification commit attempt** (including commit/push failure). Without this, intent and mechanism read as contradictory.

3. **Record allowlist rejection rationale.** The deferred mechanism choice is pinned (auto-commit extension), but the ledger lacks why a configured expected-dirty allowlist was ruled out. Add one load-bearing decision: mutating outputs are repo-specific/unpredictable at config time; misconfigured allowlists reproduce the original abort bug; symmetry with trusted pre-ready commit-if-dirty.

4. **Operator migration for mutating `readyCommand`.** Repos configured with mutating `readyCommand` that relied on abort-as-signal will silently gain harness auto-commit. The runbook AC (or a decision) must note this observable behavior change — not a code migration, but operator expectation shift.

5. **Add `v1/docs/plan-mode.md` to doc scope.** Plan-mode auto-mark-ready still describes fix → ready with no post-ready commit and green+dirty abort. Prior gate specs included `plan-mode.md`; this spec’s Documentation updates and doc AC omit it despite plan-mode inheriting `runReadyAndCommit`. Include it in doc ACs and Documentation updates.

6. **Pin exit-6 `dirty-worktree` exclusion for post-verify harness commits.** `run-loop.md` exit-6 row excludes harness-owned pre-ready `chore: apply pre-ready check:fix`. Post-verification `chore: apply post-ready verification output` is the same class. Without pinning, iteration/completion dirty checks may misclassify harness-owned post-verify commits. Extend the run-loop doc AC (and ledger if needed) to cover this exclusion alongside post-verification failure rows.

7. **Test AC for recorded-green timing with post-commit HEAD change.** AC #8 states recorded-green is captured only after clean porcelain post post-verify commit, but no test AC forces an implementer to prove HEAD advances through post-verify commit. Extend test coverage AC to require a case where post-verify commit changes SHA and recorded-green captures the post-commit HEAD, not pre-commit.

8. **Pin post-verification test seam.** Harness subspecs may name structure when it is the contract. Mirror pre-ready’s `commitPreReadyFix`: ledger or tasks must name a sibling seam (e.g. `commitPostVerification`) so sandbox/unit tests can inject ordering without implementer drift.

9. **Sharpen residual-dirty error message contract.** AC #5 gives semantic direction (inspect unexpected changes; don’t fold autofix into `readyCommand`) but not message shape. Pin that residual `ReadyVerificationDirtyError` (or successor) follows the pre-ready still-dirty template structure — green verification, commit attempted, worktree still dirty, inspect — with flipped guidance. Prevents technically compliant but weak operator messaging.

10. **Doc AC: no re-verification after post-verify commit.** Decision already rules out verify-after-commit loops. Ensure `v2/docs/v1-behaviors.md` AC explicitly records that post-verify commit does not re-run verification and CI is the backstop — closes the “committed output might fail if re-run” gap without a behavioral AC.

---

**No refinement required (upheld as sufficient):**

- **Fast-tier mutating `readyCommand`:** In scope boundary; full-tier completion is the motivating bug; fast preservation is explicit. Optional one-line acknowledgment of inter-phase absorption via next `full` gate is not blocking.
- **Subspec atomicity:** Single observable behavior through one shared helper; comparable scope to prior gate spec.
- **Sandbox integration test depth:** Post-verify ordering pinned in `ready-gate.test.ts` plus named seam is sufficient; full sandbox ordering assertions optional.
- **`firstRedBaselineSha`:** No interaction with post-verify commit (green-only path); omit.
