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

- [ ] After every `commitSubspec` call (subspec 04), invoke a `pushCurrent()`
  helper that runs `git push` and surfaces stderr verbatim on failure.
- [ ] Ensure the first-commit path uses `-u` and that subsequent calls do
  not.

## Acceptance criteria

- After each subspec, `gh pr view --json commits` shows the new commit on the
  PR.
- A network failure during push results in a blocker, not a silent
  continuation.

## Docs

- Note the push cadence in the README git-workflow section.
