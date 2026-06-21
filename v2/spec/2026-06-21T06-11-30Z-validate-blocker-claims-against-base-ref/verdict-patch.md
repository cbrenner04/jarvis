I've confirmed the two material findings against the code. Here is my verdict.

## Verdict — Refinement Required

### Required outcomes

**1. The production base-ref runner must have direct test coverage.**
Subspec `01`'s task-checklist item ("tests covering green base, red base, and worktree cleanup after the test run throws") and several `01` ACs ("blocker rejected without any injected seam," "detached-commit worktree, not a branch checkout," "worktree removed even when the test run throws") are ticked `[x]`, but no test exercises the real `runBaseRefTests` impl. The only no-seam test sets up a repo with no test infrastructure, so the runner returns false and the test only confirms the fail-safe (exit-7) path — it never drives merge-base resolution, the detached worktree, a genuinely green/red `bun run test`, or cleanup-on-throw. The detached-worktree mechanism, which is the entire substance of `01`, has zero direct coverage.

Required: add a dedicated test for `base-ref-test-runner.ts` against a real git repo proving (a) a green base returns true and rejects the blocker end-to-end, (b) a failing test command returns false / blocker stands, and (c) a throwing test command still removes the worktree (no leftover). The ticked `01` ACs must be backed by tests, not asserted. This is the blocking gap.

**2. The base branch must be resolved, not hardcoded.**
`iteration.ts:785` calls the validation seam with the literal `"main"`, making the seam's `baseBranch` parameter dead. On any repo whose base is `master`/`develop`, `git merge-base "main" HEAD` fails, the runner returns false, and the feature silently never fires — contradicting `01`'s stated decision that the base is "the merge-base of the agent branch and **its base branch**." Although the failure mode is in the safe direction (feature fails to fire; a real blocker is never wrongly rejected), the parameter is dead and the behavior diverges from the spec.

Required: resolve the actual base branch rather than passing a literal, so validation fires on non-`main` repos. Preserve the spec's offline intent — the merge-base + test run must remain network-free; if base-branch-name resolution itself can require network, that degradation must be documented, not silently introduced.

**3. Correct the `v1-behaviors.md` wording.**
The doc currently ties the offline property to the hardcoded branch. The offline guarantee comes from `git merge-base` regardless of branch name; once #2 is fixed, ensure the doc states the offline property accurately and does not conflate it with a hardcoded base.

### Not required (noted)

- Resetting the rejection counter on AC progress (the counter is effectively lifetime-per-subspec rather than strictly "consecutive") is a safe-direction refinement, not a defect — standing after the bound is the conservative outcome the spec intends. Optional.
- Dead/redundant classifier patterns, the misleading merge-base comment above the `"main"` call, the defensive `runBaseRefTests !== undefined` guard, and the test name "requires validation seam to reject" are cosmetic. Optional cleanup; cleaning the misleading comment is worthwhile alongside #2.
- Uncommitted AC progress in a reject iteration is spec-accepted; no action.