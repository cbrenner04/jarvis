# Converge rejected actuator push to PR head and let auto-ready finish

## Problem

A review actuator commits, then `pushCurrent` is rejected non-fast-forward
(`v1/src/modes/patch/review.ts` ~960). The error is permanent (not transient,
so not retried), caught, and rethrown as `ReviewTerminalError(..., 1)` →
`mapReviewExitCode` → exit `11` (`review-incomplete`). The worktree is left
diverged: local HEAD = gate-green implementation commit + failed actuator
commit; the PR head (origin/`<branch>`) carries the intact, ticked, lint-clean
implementation work. The exit-`11` auto-ready (`maybeMarkReady`,
`completion-pipeline.ts` ~555) then runs against the diverged local HEAD instead
of the PR head and does not ready the PR, forcing manual finalize.

Recover deterministically: when the sole divergence above the PR head is the
failed actuator commit, converge local HEAD to the PR head (discard the actuator
commit) so the existing exit-`11` auto-ready readies the PR head.

## Decisions

Convergence happens inside the review actuator push-failure handler in
`review.ts`, before exit-`11` propagates — so the existing
`completion-pipeline` exit-`11` auto-ready needs no special casing. (Alternative:
detect-and-converge in the `completion-pipeline` exit-`11` handler — rejected:
the actuator commit sha and the failure context are local to `review.ts`.)
Converge only on a non-fast-forward push rejection — distinct from transient
network errors (already retried) and other permanent push errors (still
surfaced, no convergence).
Converge only when the sole divergence above the PR head is the failed
review-actuator commit and the PR head equals the recorded gate-green head — the
proof the PR head carries the complete work. Otherwise leave the worktree as-is
and surface the failure (no destructive reset). Rules out blindly resetting a
worktree that carries non-actuator divergence.
Convergence is `git reset --hard` to the fetched PR head — discards the local
actuator commit; the work is already on the PR head, so nothing is lost.
Deferred to first consumer: behavior when multiple stacked review-actuator
commits diverge from the PR head — pin when a run exhibits it; this spec converges
the single-failed-commit case and leaves multi-commit divergence surfaced.

## Task checklist

- [ ] Classify the non-fast-forward actuator push rejection in the
  `review.ts` actuator commit/push handler.
- [ ] On that classification, when the sole divergence above the PR head is the
  failed actuator commit, fetch + reset local HEAD to the PR head; otherwise
  surface the failure unchanged.
- [ ] Confirm the existing exit-`11` auto-ready readies the converged PR head
  (tree now matches recorded gate-green head → `gh pr ready`).
- [ ] Tests: rejected-actuator-push converges + readies; non-convergeable
  divergence stays surfaced; non-ff classification is distinct from transient
  and other permanent push errors.

## Acceptance criteria

- [ ] A non-fast-forward review-actuator push rejection is classified distinctly,
  not surfaced as an unrecovered diverged worktree.
- [ ] When the only divergence above the PR head is the failed actuator commit,
  the worktree HEAD converges to the PR head (the actuator commit is discarded)
  and the worktree is no longer diverged.
- [ ] When the divergence above the PR head is more than the failed actuator
  commit, the worktree is left unchanged and the push failure is surfaced (no
  destructive reset).
- [ ] On `review-incomplete` (exit `11`) whose sole divergence was a failed
  actuator push, auto-ready readies the converged PR head; the run still exits
  `11`.
- [ ] A transient push error and a non-fast-forward rejection are handled
  differently: the transient path retries as before; only the non-fast-forward
  rejection triggers convergence.

## Documentation updates

- `v2/docs/v1-behaviors.md`: amend the actuator-infra-error (exit `11`) and
  review-incomplete auto-ready entries to record that a non-fast-forward
  actuator push rejection converges the worktree to the PR head and the exit-`11`
  auto-ready then readies the PR head.
- `v1/docs/run-loop.md`: update the review-incomplete auto-ready description and
  the exit-`11` table row to state the rejected-actuator-push convergence and
  auto-ready, removing the implication that this case requires manual finalize.
- `v1/docs/operator-runbook.md`: drop the rejected-actuator-push case from the
  manual-finalize recovery path if listed (now harness-owned).
