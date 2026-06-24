# Verdict

## Upheld — one required outcome

**Unify the PR-state query so the table column and the session-end verdict draw from a single result per worktree.**

The implementation fetches PR state twice for every worktree: a module-level `getPrState` (raw `execSync`) feeds the `NAME/DIRTY/PR/SPEC` table column, while a separate injected `ghRunner.getPrState` feeds the verdict's landed-vs-outstanding classification. These are two independent `gh pr view <branch> --json state` calls on the same branch.

This violates an explicit, load-bearing decision in subspec 00: *"Outstanding-state derivation reuses the existing dirty/unpushed/PR-state helpers — rules out a parallel detection path that could disagree with the table rows."* The dirty and unpushed signals are correctly shared; PR state is not. The divergence is observable, not theoretical — in the mixed-sweep test the table column hits real `gh` (rendering `no PR`) while the verdict reports the same branch as MERGED/landed from the stub. That is exactly the disagreement the decision was written to forbid.

This single fix must also satisfy two consequences of the same root cause:
- **Seam completeness (R2):** the pre-existing table `getPrState` must run through the same injectable runner seam, not raw `execSync`, so the table and verdict are testable from one stubbed source.
- **Redundant gh calls:** routing both display and classification through one `getPrState` → `{state, isDraft}` result per worktree eliminates the doubled PR-state invocation, restoring the per-worktree frugality decision 01 deliberately preserved for landed worktrees.

Required outcome: one PR-state fetch per worktree, returning both `state` and `isDraft`, feeding both the table column and the verdict classification, reachable through the test seam. The table's `NAME/DIRTY/PR/SPEC` output must remain unchanged.

## Not upheld — no action

- **`getSpecProgress` stub / "will be filled in by subspec 01" comment:** pre-exists on `main`, untouched by this branch, out of scope.
- **`UNKNOWN` gate state:** GitHub's own merge-state enum surfaced verbatim — that is precisely what decision 01 mandates. `UNKNOWN` (GitHub still computing) and `unavailable` (no PR / query failure) carry distinct signal; collapsing them would lose information. Spec-compliant.
- **"fully pushed" not literally verified for a deleted upstream:** the documented safe case (deleted upstream = merged-and-cleaned = landed), called out in the docs. No change.