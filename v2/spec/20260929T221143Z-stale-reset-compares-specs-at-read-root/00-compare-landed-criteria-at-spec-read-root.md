# Compare landed criteria at the spec tree's read root

## Problem

Gate 2 (landed-criteria drift) only engages when `isStaleResetLandedCriteriaSpecPath(projectRoot, specPath)` holds, which requires the spec path to sit inside the code project root (`v2/src/commands/cleanup.ts:2821`). A spec tree in an external home or a prior-stage worktree returns `false`, so `trackableSpecPath` is `undefined` and `applyPreContinuationGates` skips the drift comparison entirely: a worktree whose subspec is ticked but whose base has that criterion unticked is retired without refusal. The early return exists because the comparison remaps each spec path through `join(worktreePath, relative(projectRoot, absPath))`, which is meaningless for a tree outside the project root.

## Decisions

- Gate 2 resolves a spec-tree read root independent of `trackableSpecPath`: in-project trees keep the worktree-relative remap (`join(worktreePath, relative(projectRoot, absPath))`), out-of-root trees read each file at its own absolute location. Rules out extending the current remap to out-of-root paths, which is what manufactures the `worktree spec unreadable` throw the early return works around.
- The out-of-root tree's base snapshot comes from the Git root containing that tree (`git -C <specDir> rev-parse --show-toplevel`), with paths relative to that root and the code lane's `baseRef` re-resolved *by name* inside it. Rules out reusing the code worktree's already-resolved base SHA, which need not name a commit in a different repository.
- Any failure to read the current tree, a linked subspec, the spec Git root, or the base snapshot refuses retirement with a named reason instead of skipping the gate. Rules out today's permissive skip; inconclusive comparison is not permission to destroy.
- Keep `trackableSpecPath` (and therefore continuation tick-backing and the rebase-for-continuation condition) in-project-only. An out-of-root lane that continues is not retired, so gate 2's protection is only owed on the retirement paths (dirty tree, nothing ahead of base, no continuation verdict).
- `--reset-despite-landed-criteria` (`skipLandedCriteriaGate`) bypasses gate 2 including its inconclusive refusal, for in-project and out-of-root trees alike.
- Gates 1 and 3, `planMergedWorktreeRemoval`'s in-repo criteria classification, and `cleanup --abandon` are untouched.

## Acceptance criteria

- [ ] A `v2/src/commands/cleanup.test.ts` regression places a linked spec tree (`index.md` plus a subspec) outside the code project root, ticks a non-human-only criterion only in the current tree, and proves `resetStaleWorkspace` refuses retirement naming that subspec path; it fails against the current out-of-root early return in `isStaleResetLandedCriteriaSpecPath`.
- [ ] A `v2/src/commands/cleanup.test.ts` test proves an out-of-root spec tree whose current file, linked subspec, Git root, or base snapshot cannot be read refuses retirement with a named reason and leaves the worktree, branch, and commits intact.
- [ ] `v2/src/commands/cleanup.test.ts` in-project landed-criteria drift tests stay green (in-project comparison unchanged).
- [ ] `v2/src/commands/cleanup.test.ts` tests prove `--reset-despite-landed-criteria` (`skipLandedCriteriaGate: true`) reaches retirement for both an in-project drifted tree and an out-of-root drifted or unreadable tree, while the dirty and unlanded-commit gates still refuse under that flag.
- [ ] `v2/src/commands/cleanup.test.ts` unlanded-commit, descendant, continuation tick-backing, merged-worktree retirement, and `cleanup --abandon` tests stay green (gates 1 and 3, continuation, and abandon unchanged).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — gate 2 compares external and prior-stage spec trees from their own read root and Git base, refuses with a named reason when the comparison is inconclusive, and is bypassed only by `--reset-despite-landed-criteria`; continuation tick-backing stays in-project-only.
