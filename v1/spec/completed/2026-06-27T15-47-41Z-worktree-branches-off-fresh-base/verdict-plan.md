## Verdict

Three refinements are required before implementation. One minor point is advisory.

---

**1. Task items must name the correct `branchExistsOnOrigin` call target (Required)**

Both new-branch sites already call `branchExistsOnOrigin` to check the *worktree branch name*. The fix introduces a second call checking the *base branch name*. The task items currently say "if `branchExistsOnOrigin`" without specifying which name — an implementer reading the code will see existing calls and use the wrong one. Task items must explicitly say the check is `branchExistsOnOrigin(projectRoot, baseBranch)` (the base, not the new branch).

---

**2. Fallback condition must be anchored to ref-resolution, not fetch outcome (Required)**

The Problem section and AC 3 use "when the fetch fails" as the fallback trigger. The actual guard is whether `origin/<base>` resolves locally — i.e., whether `branchExistsOnOrigin(projectRoot, baseBranch)` returns false. These are not equivalent: if a prior fetch succeeded and `origin/<base>` exists, `branchExistsOnOrigin` returns true even when the current fetch fails (the stale remote-tracking ref is still used, which is intentional and correct). The spec must state the fallback condition as "when `origin/<base>` does not resolve locally" throughout — in the Decisions section, task items, and ACs — and drop the "fetch fails" framing.

---

**3. AC 3 must distinguish no-origin from ref-absent (Required)**

AC 3 bundles "fetch fails OR no `origin/<base>` ref" as the offline/no-origin fallback case. The spec guidance requires ACs to describe observable behavior, and these are two distinct conditions with different test setups. AC 3 should cover two concrete fallback cases: (a) no remote origin configured, (b) `origin/<base>` ref absent locally (e.g., never fetched). The "fetch fails but stale ref exists → uses stale remote-tracking ref" case is intentional behavior, not a fallback, and need not be an AC — but it should not be silently subsumed into the fallback AC either.

---

**4. Doc AC should reference the specific section in `worktrees-and-commits.md` (Advisory)**

The documentation update AC tells the implementer what to add but not where. Adding a section anchor (e.g., "in the *Neither exist* subsection") makes the update verifiable in review. This does not block implementation but should be addressed in refinement.

---

**Not required:** The existing-branch preservation AC (AC 5) citing `plan-worktree.test.ts` is structurally correct per the refactor-AC guidance. Whether the test file covers existing-branch paths is a pre-implementation verification, not a spec defect. The `resolvedBase` naming question in `createManagedWorktree` dissolves if finding 1 is addressed. No AC is needed to verify that `git branch` does not modify the local base ref — that is git semantics, not harness behavior.