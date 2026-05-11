# 01 - gh preflight and base branch detection

## Problem

Every PR-bearing run must assume `gh` is installed and authenticated. The base
branch must be discovered from the remote rather than hardcoded.

## Decisions

- Run `gh auth status` once at the start of any run that will touch git/PR
  state. On non-zero exit, abort with a message that tells the user to run
  `gh auth login`. Do not attempt to install or authenticate `gh`.
- Resolve the base branch with
  `gh repo view --json defaultBranchRef -q .defaultBranchRef.name` and cache it
  for the duration of the run.
- Never fall back to plain `git` for any GitHub-side operation (PR create, PR
  view, default branch lookup, etc.).

## Tasks

- [ ] Add a preflight module that exposes `assertGhReady()` and
  `getBaseBranch()`.
- [ ] Wire `jarvis run` to call `assertGhReady()` before any worktree or
  branch work.
- [ ] Surface `gh` stderr verbatim on failure so the user sees the real cause.

## Acceptance criteria

- Running with `GH_TOKEN` unset and no cached auth exits before any git side
  effects, with a message naming `gh auth login`.
- Running against a repo whose default branch is not `main` (e.g. `master`,
  `trunk`) uses the detected name everywhere it's needed.

## Docs

- Add `gh` (installed + authenticated) to the prerequisites section of the
  README.
