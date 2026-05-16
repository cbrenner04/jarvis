# 06 - Push per commit

## Problem

Reviewers and CI need to see incremental progress; the draft PR must reflect
the latest commit shortly after each subspec lands.

## Decisions

- First commit: `git push -u origin <branch>` (handled together with subspec
  05's PR creation).
- Every subsequent commit: `git push` immediately after the commit.
- Push failures are blockers (see subspec 07). No silent retry, no `--force`,
  no `--force-with-lease` unless the user explicitly invokes a separate
  recovery path (out of scope here).

## Tasks

- [ ] Implement a `pushCurrent({ firstPush }: { firstPush: boolean })`
  helper. When `firstPush` is true, run
  `git push -u origin <current-branch>`. Otherwise run plain `git push`.
  Surface stderr verbatim on failure.
- [ ] Wire `pushCurrent` into the run loop in `src/commands/run.ts` so it is
  called immediately after every successful `commitSubspec` (added in
  subspec 04). The first commit of the run uses `firstPush: true`; all
  others use `firstPush: false`.
- [ ] On push failure, do not retry, do not `--force`, do not
  `--force-with-lease`. Treat as a blocker per subspec 07 and exit.

## Acceptance criteria

- After each subspec, `gh pr view --json commits` shows the new commit on the
  PR.
- A network failure during push results in a blocker, not a silent
  continuation.
- A regression test drives a two-subspec run and asserts two pushes were
  invoked, the first with `-u`, the second without. Mock `git push` if the
  test cannot reach a real remote.

## Docs

- Note the push cadence in the README git-workflow section.
