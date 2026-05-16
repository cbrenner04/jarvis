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
- [ ] Wire `ensureDraftPr` into the run loop in `src/commands/run.ts` so it
  fires immediately after the first successful `commitSubspec` + push of a
  run. Subsequent iterations must not invoke it (resume case: the existence
  check guards correctness, but the call should be skipped on the hot path).

## Acceptance criteria

- A clean run produces a draft PR with the expected title after the first
  subspec lands.
- Re-running after deleting the local worktree and PR-side state continues to
  the existing PR rather than opening a duplicate.
- The PR body is not modified on subsequent commits.
- A regression test drives a fresh two-subspec run end-to-end and asserts
  exactly one draft PR is created, with `gh pr view --json isDraft` returning
  `true` after the first commit.

## Docs

- Document title/body sourcing in the README git-workflow section.
