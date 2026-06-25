# Reconcile actuator tip with remote before push

## Problem

On a criteria-complete, gate-green run the post-completion review actuator
commits locally and pushes (`v1/src/modes/patch/review.ts` ~969-977). When
`origin/<branch>` holds commits not in local `HEAD`, the actuator push is
rejected non-fast-forward; the worktree HEAD diverges from the PR head, forcing
a manual finalize. Observed on `markdown-corpus-normalize` (PR #499).

## Decisions

Observed #499 cause: completion had already pushed the implementation commit to
`origin/<branch>` and opened the PR; the actuator then committed locally on a
tip that did not include that remote tip (and any same-PR commits already on
`origin/<branch>` from earlier in-cycle `commitPass` pushes), so push was
rejected non-fast-forward. Rebase onto `origin/<branch>` is safe — those commits
are same-PR work on the PR head, not foreign tip work. Rules out treating
`origin/<branch>` as untrusted foreign history.
Reconcile after the actuator commit, before push — a dirty tree cannot be
rebased; commit then rebase the new commit onto the remote. Rules out
reconcile-before-commit (would require stash).
Rebase onto `origin/<branch>` only when `git rev-list --count HEAD..origin/<branch>`
is non-zero (remote has commits not reachable from local `HEAD`); skip when zero.
Rules out rebasing when local is strictly ahead or checking the wrong direction.
Reconcile runs only inside the existing non-empty-porcelain actuator block, so a
clean (no actuator changes) pass neither fetches, rebases, nor pushes. Rules out
unconditionally fetching every pass.
Reuse `bestEffortFetch` for the fetch step. Fetch failure (offline / no origin)
is non-fatal: skip rebase and fall through to push as today; divergence may
still occur — `review-incomplete` auto-ready re-runs the ready gate and may mark
the PR ready but does not reconcile branch divergence. Rules out failing the run
when the network is down or treating auto-ready as a reconcile backstop.
After a successful fetch, skip rebase when `hasUpstream` is false or
`branchExistsOnOrigin` is false for the current branch (no `origin/<branch>`
ref). Rules out collapsing missing-upstream with fetch failure or re-deriving
upstream detection.
A rebase conflict aborts (`git rebase --abort`), keeps the actuator commit
unpushed on the pre-rebase base, and throws `ReviewTerminalError` (remapped to
exit `11` / `review-incomplete`); implementation commits stay intact; divergence
from the PR head persists on this rare path. Rules out leaving the worktree
mid-rebase, discarding the actuator commit, or implying convergence on conflict.

## Task checklist

- Add a reconcile helper in `v1/src/worktree.ts` (injectable exec like
  `pushCurrent`) that calls `bestEffortFetch`, then rebases the current branch
  onto `origin/<branch>` when that ref has commits not reachable from local
  `HEAD`, aborting on conflict and signaling failure to the caller.
- Wire it into the actuator commit/push block in `v1/src/modes/patch/review.ts`
  between the commit and `pushCurrent`.
- Map fetch failure to non-fatal skip; map missing `origin/<branch>` (after
  fetch) to skip via `hasUpstream` / `branchExistsOnOrigin`; map rebase conflict
  to `ReviewTerminalError` (exit `11` via existing remapping).
- Add unit tests for the helper: remote-ahead → branch fast-forwardable onto
  `origin/<branch>`; fetch failure → skip; missing `origin/<branch>` → skip;
  rebase conflict → abort + error.
- Add integration coverage (review actuator path or `run.test.ts`) that
  reconcile + `pushCurrent` succeeds when `origin/<branch>` is ahead.
- Update `v1/docs/run-loop.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [x] When `origin/<branch>` has commits not reachable from local `HEAD` at actuator push time, the actuator fetches and rebases onto `origin/<branch>` so `pushCurrent` is a fast-forward and the worktree HEAD does not diverge from the PR head.
- [x] `v1/src/modes/patch/review.ts` empty-porcelain actuator branch stays unchanged (no fetch, rebase, or push).
- [x] Fetch failure is non-fatal: reconcile is skipped and the actuator proceeds to `pushCurrent` (divergence may still occur).
- [x] After a successful fetch, missing `origin/<branch>` (`hasUpstream` false or `branchExistsOnOrigin` false) skips rebase and proceeds to `pushCurrent`.
- [x] Rebase conflict aborts the rebase, keeps the actuator commit unpushed, throws `ReviewTerminalError` remapped to `review-incomplete` (`11`) with implementation commits intact; the worktree is not left mid-rebase and remains diverged from the PR head.
- [x] Helper unit tests cover remote-ahead fast-forwardable rebase, fetch-failure skip, missing-upstream skip, and rebase-conflict abort; integration coverage asserts `pushCurrent` succeeds after reconcile when `origin/<branch>` is ahead.

## Documentation updates

- `v1/docs/run-loop.md`: review actuator reconciles (`bestEffortFetch` + rebase onto `origin/<branch>` when remote has unreachable commits) before `pushCurrent`; note fetch/upstream skip paths and conflict → `ReviewTerminalError` / exit `11` with divergence persisting.
- `v2/docs/v1-behaviors.md`: update review-actuator commit/push entry for pre-push reconcile and failure modes (changes existing v1 functionality).
