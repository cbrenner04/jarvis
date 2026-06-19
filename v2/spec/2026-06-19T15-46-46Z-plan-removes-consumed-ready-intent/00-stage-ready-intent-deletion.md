# Stage ready-intent deletion into the spec PR

## Problem

A `commit: true` `jarvis1 plan` run copies the ready-intent at
`<targetDir>/ready-intents/<name>.md` into the spec tree as `intent.md`, but the
source ready-intent file survives on the plan branch. Merging the spec PR ships
the spec while leaving the now-consumed ready-intent in `ready-intents/`, so it
lingers and can be re-consumed.

The fix: on a `commit: true` run, delete the source ready-intent inside the plan
worktree so the deletion is staged into the `plan: draft` commit. Merging the
spec PR then clears `ready-intents/`. The operator's main checkout is never
touched directly — only the worktree branch copy is removed, and the deletion
reaches `main` through the merge.

## Decisions

- Deletion is jarvis-driven, not agent-driven: jarvis removes the worktree's
  `<targetDir>/ready-intents/<name>.md` after the byte-for-byte `intent.md` copy
  is written and before the `plan: draft` commit's `git add -A`. Rules out
  letting the draft agent decide whether/which file to remove (non-deterministic).
- Target path is derived deterministically from the resolved ready-intent path
  made relative to the project root, then joined onto the worktree path — same
  ready-intent in, same single file out. Rules out a glob or name-pattern match
  that could remove the wrong file.
- The in-memory `readyIntentContent` is the source for the `intent.md` copy, so
  deleting the source file does not affect the copy. Rules out re-reading the
  source after deletion.
- Scope deletion to `commit: true`. For `commit: false` the ready-intent is left
  in place: the worktree is the operator's live checkout and there is no spec PR
  to carry the deletion, so removing it would be an uncommitted working-tree
  mutation. Rules out deleting in the live checkout with no commit record.
- If the derived path is not present in the worktree (ready-intent resolves
  outside the repo / not committed there), stage no deletion and proceed; the
  `intent.md` copy still rides. Rules out aborting the run over a missing source.
- Resume (`--resume`) needs no deletion logic: the deletion already lives on the
  plan branch from the fresh run; resume recreates the worktree from that branch.

## Task checklist

- [ ] Delete the worktree's source ready-intent before the draft commit on
  `commit: true` runs.
- [ ] Cover the new behavior with a test.
- [ ] Update docs (plan-mode.md, v1-behaviors.md).

## Acceptance criteria

- [ ] A `commit: true` `jarvis1 plan` run on a ready-intent stages deletion of
  `<targetDir>/ready-intents/<name>.md` into the `plan: draft` commit that
  carries the spec tree, so the committed plan-branch tree no longer contains
  that ready-intent file.
- [ ] The same run's `<targetDir>/<spec-dir>/intent.md` remains a byte-for-byte
  copy of the original ready-intent (frontmatter, sentinels, prerequisites
  intact) despite the source deletion.
- [ ] The deletion of one ready-intent removes exactly that file; no other
  `ready-intents/` entry is staged for deletion.
- [ ] A `commit: false` `jarvis1 plan` run leaves the source
  `<targetDir>/ready-intents/<name>.md` in place and unmodified.
- [ ] A `commit: true` run whose ready-intent source is not present in the
  worktree checkout still completes the copy-and-draft flow without error and
  stages no deletion.

## Documentation updates

- `v1/docs/plan-mode.md`: state that a `commit: true` run deletes the consumed
  ready-intent on the plan branch and the deletion rides in the `plan: draft`
  commit, so merging the spec PR clears `ready-intents/`; `commit: false` leaves
  it in place.
- `v2/docs/v1-behaviors.md`: update the existing bullet asserting "the source
  ready-intent is left untouched" to record the new behavior (deleted on the
  plan branch under `commit: true`, staged into `plan: draft`; left in place
  under `commit: false`).
