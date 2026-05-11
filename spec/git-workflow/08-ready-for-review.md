# 08 - Flip to ready for review

## Problem

When all subspecs are checked, the PR should transition from draft to ready
for review without human intervention. Jarvis never merges — humans do.

## Decisions

- Trigger: after a successful `commitSubspec` + push, if every checklist item
  in `index.md` is now `[x]`, mark the PR ready.
- Use `gh pr ready` against the current branch.
- If there is no PR (shouldn't happen — subspec 05 guarantees one), error
  with a clear message rather than silently proceeding.
- Do not auto-merge. Do not request reviewers in this spec (separate
  concern).

## Tasks

- [ ] Add `maybeMarkReady()` invoked at the tail of the commit/push pipeline.
- [ ] Parse `index.md` checkboxes to determine completeness; ignore lines
  that are not part of the canonical subspec list.

## Acceptance criteria

- Completing the final subspec results in the PR's `isDraft` field becoming
  `false` (verified via `gh pr view --json isDraft`).
- Partial completion never flips the PR.

## Docs

- Document the ready-for-review trigger in the README git-workflow section.
