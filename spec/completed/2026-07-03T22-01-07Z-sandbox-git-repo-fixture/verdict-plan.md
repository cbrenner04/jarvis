## Verdict

**Upheld — require refinement:**

1. **Cleanup-helper fit is asserted, not verified.** The subspec's task checklist states the migrated test "uses `trackedTempRoots()`... instead of its own cleanup" as unconditional, but the intent only says "reuse shared temp-root cleanup if available." The subspec must either confirm `trackedTempRoots()` (from `write-fixtures.ts`) actually fits the git-repo fixture's allocation pattern, or restate the task as conditional per the intent's hedge, so the checklist doesn't overclaim a fit that hasn't been established.

2. **"Tracked temp root" is underspecified.** The task checklist says the new fixture's files are "allocated under a tracked temp root" without naming which existing helper/call performs that allocation. Tighten this to name the specific mechanism (e.g., the exact function from `write-fixtures.ts` the fixture calls), so implementers aren't left to invent an allocation path.

3. **Ordering/interaction between `getLockRoot` and the new cleanup mechanism is unstated.** `getLockRoot` stays file-local per the intent, but the subspec doesn't say how or when it's derived relative to the tracked-root allocation and the git-repo setup sequence, nor whether any other test depends on the current lifetime `setupRepo()` provides. Add an explicit note on the ordering (allocate tracked root → derive lock root → run git setup) or confirm no lifetime dependency exists elsewhere.

**Not upheld as blockers (out of scope for this subspec):**

- The lack of an automated, standing lint/enforcement mechanism for "only `.sandbox-unrunnable.test.ts` may import this fixture" is a real gap, but the intent explicitly scopes this work to a single extraction ("rules out broad... refactors," file-local `getLockRoot` "for now"). Building enforcement tooling is separable future work, not a requirement of this subspec — no spec change needed here beyond acknowledging the comment-only guard is what's in scope.

**Rationale:** These refinements keep the subspec's stated tasks and decisions consistent with what the intent actually commits to (conditional reuse, no invented precision on unexercised behavior per the deferral principle), and close a concrete gap — the `getLockRoot`/cleanup ordering — that could silently break test lifetime behavior during the extraction. All three are cheap wording/ordering fixes, not scope expansions.