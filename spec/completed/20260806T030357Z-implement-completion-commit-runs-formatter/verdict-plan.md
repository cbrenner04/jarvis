Verifying key codebase claims before issuing the verdict.
## Verdict: required refinements

1. **Honest failure contract at the committer seam** — The decision ledger and the formatter-failure acceptance criterion overclaim `completion_commit_failed`. Formatting inside `preparePendingCommit` throws before staging; callers already map committer throws to `iteration_commit_failed` (iteration checkpoint commits) or `completion_commit_failed` (terminal/publication paths). The spec must state fail-closed throw semantics (no `git add -A`, no commit, no unformatted output staged) and acceptance criteria must assert that committer-level contract—not a single named loop outcome unless write-loop mapping is explicitly added to scope.

2. **Explicit all-caller scope for `preparePendingCommit`** — Formatting at this seam runs for every committer invocation: per-iteration checkpoint commits, terminal completion, and ready-gate repair re-commits. The spec frames the problem as terminal implement → CI `check` but does not record that wider blast radius. Add an explicit ledger decision that this single-surface choice is intentional; primary motivation is CI `check` on the completion commit; iteration/repair scoped formatting is accepted overhead.

3. **Operator-runbook documentation instruction** — “Leave the cognitive-complexity bullet intact” conflicts with the needed update: that bullet currently opens with “Implement does not run biome.” After this change, implement runs scoped format-only Biome before staging. Documentation updates must require revising that premise while preserving the non-autofixable complexity recovery guidance (`fix` / `check:fix:unsafe` cannot repair it; `biome-ignore` or extract helpers). Same check for `write-behavior.md` if it echoes the old premise.

4. **Restore a valid mutation-checkpoint criterion** — The subspec regressed from the intent: mutation coverage is folded into the success-test AC instead of a separate criterion with a linked `// @mutate` directive in the pinning test. Spec guidance requires a distinct criterion selecting the directive; duplicating the success test name risks harness refusal. Restore a standalone mutation AC naming the pinning test file (unique basename or repo-relative path) with a single-line `@mutate` neutering the formatter invocation.

5. **Add timeout guard acceptance criterion** — The ledger binds formatter timeout to `iterationTimeoutMs` with fail-closed semantics matching ready-gate repair autofix. Spec guidance requires a failing-test AC for runtime guards. Add a criterion that formatter timeout throws without committing unformatted output (committer-level, same outcome-naming caveat as item 1).

6. **Tighten porcelain path enumeration** — “`git status --porcelain` including untracked” is underspecified. The spec must require `--untracked-files=all` and reuse the established `pathFromPorcelainLine` parsing pattern (rename/`->` handling, no aggregate `slice(3).trim()`), not the `getUncommittedPaths` approach in `write-loop.ts`. Ledger or work should pin this so implementers do not reintroduce the known path-truncation bug.

7. **Resolve timeout threading deferral vs work item** — The ledger defers “exact timeout/threading seam” while work requires threading `iterationTimeoutMs` from write-loop and workflow-runner call sites. Pin the seam in the ledger (e.g. extend `CompletionCommitInput` and pass from callers) or add an AC that injected `iterationTimeoutMs` is honored (stub runner + short timeout), so a hardcoded default cannot satisfy the spec without meeting the budget contract.

8. **Empty changed-path set** — Unspecified behavior when porcelain yields no paths. The spec must state: skip the format invocation and proceed to existing staging logic—avoid accidental repo-wide Biome or spurious failure on clean/no-op trees.

9. **Bound primary target / fail-closed without Biome** — Clarify that completion formatting invokes Biome directly (not package-manager script resolution); primary target is repos whose CI `check` includes Biome (Jarvis-shaped targets). Worktrees without a usable `biome` fail closed with commit blocked—not skip-when-absent semantics. One ledger line prevents surprise on exotic targets without expanding v1 scope.

10. **Align intent documentation list with subspec** — Subspec adds `v2/docs/v1-behaviors.md` per spec guidance for behavior changes; intent omits it. Intent documentation updates should include the parity catalog entry so implement agents reading intent alone do not skip it.

11. **Note fixture expectations in work** — Success-path ACs require real worktree mutation, real Biome subprocess, and post-commit `bun biome check`—not mocks that preserve pre-fix ordering. A work bullet noting extension from fake-git/mocked `runGit` fixtures to real git init + formatter seam reduces risk of shallow test satisfaction.

12. **Optional but valuable doc note: repair double-pass** — Ready-gate repair runs `fixCommand` then commits through the same committer, so a second scoped format pass may occur. One sentence in `write-behavior.md` prevents future confusion; not blocking if other doc updates are otherwise complete.

**Rationale:** Items 1, 4, 5, and 7 prevent a stranded implement run (unsatisfiable or mis-verified ACs, harness mutation refusal). Items 2, 3, 6, 8, and 9 prevent contradictory operator guidance and known porcelain bugs. Item 10 aligns intent with spec-guidance parity requirements. Item 11 guards against tests that tick ACs without enforcing format-before-staging ordering.

**No split required** — One execution-loop surface; refinements stay within a single atomic subspec.