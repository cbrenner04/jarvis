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
  `<targetDir>/ready-intents/<name>.md`. Rules out letting the draft agent decide
  whether/which file to remove (non-deterministic).
- Deletion runs **after the write-boundary check passes and before the
  `plan: draft` commit is created**. Plan mode's boundary enforcement scans
  `git status` and reverts any change whose path falls outside the spec
  directory — a deletion under `ready-intents/` would be reverted there. Placing
  the deletion after the check (so the check never sees it) and before the commit
  (so it is staged by the commit's `git add -A`) is the only window that both
  survives enforcement and lands in the spec PR. Rules out the inferior
  alternative of widening the boundary's allowed-path set.
- Target path is derived deterministically from the resolved ready-intent path
  made relative to the project root, then joined onto the worktree path — same
  ready-intent in, same single file out. Rules out a glob or name-pattern match
  that could remove the wrong file.
- The derived target is deleted only if it resolves **within the worktree**.
  Ready-intent validation only checks the parent basename is `ready-intents`, not
  containment, so an absolute source outside the repo would yield a
  `../`-escaping path that resolves outside the worktree onto the operator's live
  checkout. If the resolved target escapes the worktree, stage no deletion and
  proceed. Rules out a bare existence guard, which would not catch an escaped
  target that happens to exist.
- The in-memory `readyIntentContent` is the source for the `intent.md` copy, so
  deleting the source file does not affect the copy. Rules out re-reading the
  source after deletion.
- Scope deletion to `commit: true`. For `commit: false` the ready-intent is left
  in place: the worktree is the operator's live checkout and there is no spec PR
  to carry the deletion, so removing it would be an uncommitted working-tree
  mutation. Rules out deleting in the live checkout with no commit record.
  Accepted gap: consumed no-commit ready-intents are therefore never cleaned by
  any path.
- If the source ready-intent is not committed into the branch's base (an
  authored-but-unmerged ready-intent, so it is absent from the worktree's base
  tree), stage no deletion and proceed; the `intent.md` copy still rides. Rules
  out aborting the run over a source that the branch never carried.
- Blocked-draft / abandoned-branch fallback: a blocker appended after the
  boundary check rides with the committed draft, so the deletion merges once the
  operator resolves it. If the branch is abandoned instead, the deletion lives
  only on that branch and `main`'s `ready-intents/` is untouched, leaving the
  intent re-consumable — the correct fallback.
- Resume (`--resume`) needs no deletion logic: a fresh run that fails before the
  draft commit never stages the deletion, so nothing ships; the deletion is
  durable only once the draft commit exists, and resume recreates the worktree
  from that branch where the deletion already lives.

## Task checklist

- [ ] Delete the worktree's source ready-intent before the draft commit on
  `commit: true` runs.
- [ ] Cover the new behavior with a test.
- [ ] Update docs (plan-mode.md, v1-behaviors.md).

## Acceptance criteria

- [x] A `commit: true` `jarvis1 plan` run on a ready-intent stages deletion of
  `<targetDir>/ready-intents/<name>.md` into the `plan: draft` commit that
  carries the spec tree, so the committed plan-branch tree no longer contains
  that ready-intent file.
- [x] The deletion survives the write-boundary check and lands in the same
  `plan: draft` commit that carries the spec tree — not reverted by boundary
  enforcement, not split into a separate commit, and with no spurious blocker
  appended.
- [x] The same run's `<targetDir>/<spec-dir>/intent.md` remains a byte-for-byte
  copy of the original ready-intent (frontmatter, sentinels, prerequisites
  intact) despite the source deletion.
- [x] The deletion of one ready-intent removes exactly that file; no other
  `ready-intents/` entry is staged for deletion.
- [x] A `commit: false` `jarvis1 plan` run leaves the source
  `<targetDir>/ready-intents/<name>.md` in place and unmodified.
- [x] A `commit: true` run on an authored-but-unmerged ready-intent (not
  committed into the branch's base tree) still completes the copy-and-draft flow
  without error and stages no deletion.
- [x] A `commit: true` run whose resolved ready-intent path escapes the worktree
  stages no deletion, leaves the operator's checkout untouched, and completes the
  copy-and-draft flow without error.

## Documentation updates

- `v1/docs/plan-mode.md`: state that a `commit: true` run deletes the consumed
  ready-intent on the plan branch and the deletion rides in the `plan: draft`
  commit, so merging the spec PR clears `ready-intents/`; `commit: false` leaves
  it in place.
- `v2/docs/v1-behaviors.md`: update the existing bullet asserting "the source
  ready-intent is left untouched" to record the new behavior (deleted on the
  plan branch under `commit: true`, staged into `plan: draft`; left in place
  under `commit: false`).
