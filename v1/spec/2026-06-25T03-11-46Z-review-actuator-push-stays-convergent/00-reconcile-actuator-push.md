# Reconcile actuator tip with remote before push

## Problem

On a criteria-complete, gate-green run the post-completion review actuator
commits locally and pushes (`v1/src/modes/patch/review.ts` ~969-977). When the
remote tip moved ahead (implementation commit already pushed, PR opened), the
actuator push is rejected non-fast-forward; the worktree HEAD then diverges from
the PR head, forcing a manual finalize. Observed on `markdown-corpus-normalize`
(PR #499). #511 added after-the-fact recovery (re-run ready gate on exit); this
makes rejection impossible in the common case by reconciling first.

## Decisions

Reconcile after the actuator commit, before push — a dirty tree cannot be rebased; commit then rebase the new commit onto the remote. Rules out reconcile-before-commit (would require stash).
Rebase the local branch onto `origin/<branch>`, not merge — keeps the PR head linear/convergent and the push fast-forward. Rules out a merge commit on the PR head.
Reconcile runs only inside the existing non-empty-porcelain actuator block, so a clean (no actuator changes) pass neither fetches, rebases, nor pushes. Rules out unconditionally fetching every pass.
Fetch failure (offline / no origin) is non-fatal: skip rebase and fall through to push as today, leaving #511 recovery as the backstop. Rules out failing the run when the network is down.
A rebase conflict aborts the rebase (`git rebase --abort`) and surfaces as an actuator infra failure exiting `11` (`review-incomplete`) with implementation commits intact. Rules out leaving the worktree mid-rebase or force-pushing over remote work.

## Task checklist

- Add a reconcile helper in `v1/src/worktree.ts` (injectable exec like `pushCurrent`) that fetches `origin` then rebases the current branch onto `origin/<branch>` when the remote is ahead, aborting the rebase on conflict and signaling failure to the caller.
- Wire it into the actuator commit/push block in `v1/src/modes/patch/review.ts` between the commit and `pushCurrent`.
- Map fetch failure to a non-fatal skip; map rebase conflict to the existing `ReviewTerminalError`/exit-`11` actuator-failure path.
- Add unit tests for the helper (remote-ahead → fast-forward push; fetch failure → skip; rebase conflict → abort + error).
- Update `v1/docs/run-loop.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] When the remote tip is ahead of the worktree at actuator push time, the actuator fetches and rebases onto the remote so the resulting push is a fast-forward and the worktree HEAD does not diverge from the PR head.
- [ ] A pass where the actuator produces no changes neither fetches, rebases, nor pushes (the no-change path is unchanged).
- [ ] A fetch failure (no origin / offline) is non-fatal: the actuator skips reconcile and proceeds to push.
- [ ] A rebase conflict aborts the rebase and exits `review-incomplete` (`11`) with implementation commits intact; the worktree is not left mid-rebase.
- [ ] New unit tests cover remote-ahead fast-forward, fetch-failure skip, and rebase-conflict abort.

## Documentation updates

- `v1/docs/run-loop.md`: review actuator step now reconciles (fetch + rebase onto `origin/<branch>`) before push so the push is fast-forward; note conflict → exit `11`.
- `v2/docs/v1-behaviors.md`: update the review-actuator commit/push behavior entry to record the pre-push reconcile and its failure modes (changes existing v1 functionality).
