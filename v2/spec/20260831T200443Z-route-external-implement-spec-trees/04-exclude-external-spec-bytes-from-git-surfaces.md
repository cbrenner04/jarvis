# Exclude external spec bytes from Git surfaces

Completion commits, dirty-worktree checks, and publication numstat currently treat every path the agent touched, so external spec ticks or accidental copies under the worktree could enter the implementation branch.

## Decisions

- Exclude the admitted external `specReadRoot` tree (and any path resolved under it) from completion staging, `preparePendingCommit` pathspecs, terminal dirty-worktree checks, and PR numstat; rules out committing external artifacts via symlinks, copies, or direct ticks.
- Treat worktree paths whose realpath resolves under admitted `specReadRoot` as external for exclusion, not only paths lexically under the external root; rules out symlink shadows that bypass admission containment.
- Keep ordinary code changes in the worktree fully staged and published; rules out blanket `git add` skips that drop implementation edits.
- Leave in-repo spec paths inside the worktree on existing Git inclusion rules; rules out changing ordinary linked implement publication for repo-local specs.

## Tasks

- Centralize an external-spec Git exclusion helper keyed off `externalPlanSpec` + `specReadRoot` and apply it across completion staging, `preparePendingCommit` pathspecs, terminal dirty-worktree checks, and PR numstat.
- Add a Git fixture regression: run an external linked implement iteration that ticks an external subspec and lands a code edit, then assert `git log`, `git diff --name-only`, and the worktree contain the code change only — no external spec files, symlinks, or spec-only commits.

## Acceptance criteria

- [x] `v2/src/execution/workflow-runner.test.ts` Git-fixture regression proves the implementation branch contains ordinary code changes and no external spec files, copied shadows, symlinks, or spec-tick commits after external linked implement completion; it fails against the pre-fix staging path.
- [x] `v2/src/execution/completion-commit.test.ts` stays green (in-repo completion staging unchanged).

## Documentation updates

- None in this subspec; `05` owns operator-facing docs.
