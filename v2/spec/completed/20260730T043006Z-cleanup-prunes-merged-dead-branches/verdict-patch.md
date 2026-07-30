Verifying the advocate's upheld findings against the implementation before issuing the verdict.
## Verdict: required outcomes

### 1. Head-only daemon-unreachable skips must fail closed on exit status

When apply-time revalidation skips a worktree-independent merged-branch ref because the daemon is unreachable, `jarvis cleanup` must exit nonzero — including when no merged worktrees are eligible and every head-only candidate is skipped.

**Why:** The operator runbook documents that daemon-unreachable merged cleanup blocks exit nonzero. Head-only apply currently prints `Skipped ref prune: … — Daemon unreachable…` and returns `0` because `applyMergedBranchRefPrunes` only sets a failure exit on deletion errors, and final aggregation only propagates worktree-phase `daemonUnreachableExit`. That breaks the documented fail-closed signal and hides a condition operators are told to treat as actionable.

**Acceptance:** A scenario with daemon down, eligible head-only preview lines, and zero worktree retirements exits `1` (dry-run and apply).

---

### 2. Operator docs must match actual dry-run and exit semantics for merged-branch ref pruning

Update durable operator documentation so merged-branch ref pruning does not contradict the general dry-run caveat or worktree daemon rules.

**Why:** Slice 02 requires the runbook to state what cleanup previews and reports. The merged-branch section says dry-run lists refs “that **would be deleted**,” while the same doc states dry-run is a plan and apply-time guards (including daemon/durable ownership) can skip mutation. Daemon-unreachable nonzero exit is documented for merged worktrees but not for head-only apply skips. Operators cannot rely on preview lines or exit codes without this alignment.

**Acceptance:** Docs describe head-only `prune ref:` lines as apply-time candidates subject to revalidation; daemon-unreachable blocking applies to head-only ref pruning the same way it applies to merged-worktree retirement; no wording implies dry-run head-only lines are guaranteed deletions.

---

### 3. Regression test for head-only daemon-unreachable exit behavior

Add coverage proving the exit-status outcome in (1).

**Why:** Spec AC emphasize guard-inversion and fail-closed behavior for daemon/run ownership. No existing test covers head-only apply skips when the daemon is unreachable; this gap allowed the exit-code bug to ship.

**Acceptance:** A test fails on current behavior (exit `0`) and passes once (1) is fixed.

---

### Not required for this patch

- **Duplicate registry alias run-ownership:** Real edge case for misconfigured registries; spec requires deduplication, not cross-alias ownership union. Follow-up only.
- **Worktree `gh pr view` cwd:** Pre-existing; separate fix.
- **Worktree removed before post-removal revalidation:** Matches prior retirement ordering; spec requires withholding `Retired:` when prune fails, not pre-removal revalidation. Narrow daemon race between recheck and prune is optional hardening.
- **Tracking-ref disappearance blocking head deletion:** Conservative apply-time behavior; spec silent on loosening.
- **Per-repo git error isolation, empty-state copy, `getBaseBranch` fallback:** Robustness/UX follow-ups, not spec or doc AC violations.