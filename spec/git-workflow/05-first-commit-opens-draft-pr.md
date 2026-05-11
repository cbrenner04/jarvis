# 05 - First commit opens draft PR

## Problem

The PR should exist as soon as there is something to look at, but no earlier —
draft PRs against empty branches are noisy.

## Decisions

- After the first successful subspec commit, push the branch with `-u` and
  open a draft PR via `gh pr create --draft`.
- PR title = the H1 of the spec's `index.md`.
- PR body = an agent-generated summary written once at first-commit time.
  Subsequent commits do not rewrite the PR body.
- Base branch = value resolved in subspec 01.
- If a PR already exists for the branch (resume case), skip creation and
  reuse it.

## Tasks

- [ ] Implement `ensureDraftPr({ branch, base, title, bodyGenerator })`.
  Checks `gh pr view <branch> --json number,state` first; only calls
  `gh pr create --draft` if none exists.
- [ ] Generate the body by asking the active agent to summarize the spec
  (index + subspec H1s) in a single short call.
- [ ] Run this immediately after the first commit lands and is pushed.

## Acceptance criteria

- A clean run produces a draft PR with the expected title after the first
  subspec lands.
- Re-running after deleting the local worktree and PR-side state continues to
  the existing PR rather than opening a duplicate.
- The PR body is not modified on subsequent commits.

## Docs

- Document title/body sourcing in the README git-workflow section.
