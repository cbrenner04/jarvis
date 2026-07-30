Reviewing the implementation against the spec and advocate findings to issue a verdict.
## Verdict — required outcomes

### 1. Unified merged-PR authority for all ref pruning

**Outcome:** Any local head or tracking ref deleted during cleanup — including refs pruned after a managed worktree is retired — must be authorized by exactly one unambiguous `MERGED` PR whose `headRefOid` equals the current local-head OID at apply time.

**Rationale:** Subspecs 00 and 01 require the same fail-closed PR gate for head-only candidates and post-retirement pruning. The worktree retirement path currently uses weaker `gh pr view` merged-state checks that admit reused branch names, post-merge commits, and ambiguous matches. That violates the spec and the guard-inversion coverage intent for apply-time PR authority.

---

### 2. Per-candidate revalidation immediately before each mutation

**Outcome:** For every worktree retirement and every ref prune, eligibility (ref OIDs, PR authority, checkout state, durable-run ownership, daemon-run ownership) must be evaluated immediately before that candidate is mutated — not only in a bulk pre-pass that can go stale.

**Rationale:** Subspec 01 requires apply-time revalidation so a ref changed after preview is not deleted. A batch recheck separated from per-candidate work allows races and currently skips ownership revalidation on the worktree prune path (`recheckOwnership: false`). Retirement success must remain contingent on passing full revalidation at mutation time.

---

### 3. Checkout guard must allow the candidate’s own managed worktree

**Outcome:** Pre-removal checkout checks must treat the candidate’s own Jarvis-managed worktree as permitted while still rejecting `main`, the repository’s current branch, and any other worktree (including external linked worktrees) that holds the branch checked out.

**Rationale:** Subspec 00 excludes checked-out branches from head-only discovery but explicitly allows a managed-worktree branch to become eligible once this invocation retires it. A blanket “branch is checked out” rejection blocks safe retirement of merged managed worktrees unless checkout semantics distinguish the retiring worktree from other checkouts.

---

### 4. Run ownership must span all registry aliases for a deduplicated repository

**Outcome:** When multiple registry entries resolve to the same Git repository, durable-run and daemon-run ownership checks must consider every alias for that repository — not only the first alias used for ref discovery/deduplication.

**Rationale:** Subspec 00 deduplicates repository identity for ref processing, but subspec 01 extends durable/daemon ownership guards to head-only candidates. Ownership recorded under a skipped duplicate alias must still block pruning; otherwise deduplication creates a safety hole.

---

### 5. Missing local head must not silently drop eligible merged worktrees

**Outcome:** A merged managed worktree that passes worktree eligibility must remain a retirement candidate even when `refs/heads/<branch>` is absent at discovery or preview time. Worktree removal and archival must proceed under preserved behavior; only refs that actually exist at apply time go through the shared exact-ref prune path, with explicit skip/failure reporting rather than silent omission from cleanup.

**Rationale:** Subspec 01 routes retired worktrees through the common prune path but preserves existing merged-worktree eligibility and retirement behavior. Requiring `inspectBranchRefs` to succeed before admitting a worktree candidate changes that contract and can hide eligible worktrees with no error.

---

### Test coverage expectation

Add or extend `v2/src/commands/cleanup.test.ts` so each outcome above has failing-before-fix and guard-inversion coverage consistent with the completed spec’s acceptance criteria (weaker PR authority, stale bulk-only revalidation, alias-blind ownership, own-worktree checkout rejection, and silent drop on missing head).