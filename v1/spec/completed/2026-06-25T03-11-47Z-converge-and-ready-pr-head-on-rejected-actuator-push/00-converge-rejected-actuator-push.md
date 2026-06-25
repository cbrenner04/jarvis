# Converge rejected actuator push to PR head and let auto-ready finish

## Problem

A review actuator commits, then `pushCurrent` is rejected non-fast-forward
(`v1/src/modes/patch/review.ts` ~960). The error is permanent (not transient,
so not retried), caught, and rethrown as `ReviewTerminalError(..., 1)` →
`mapReviewExitCode` → exit `11` (`review-incomplete`). The worktree is left
diverged: local HEAD carries the actuator commit; the PR head
(`origin/<branch>`) may differ in sha but carries the same tree (e.g. squash
merge advanced the remote). The exit-`11` auto-ready (`maybeMarkReady`,
`completion-pipeline.ts` ~555) runs against the diverged local HEAD and does
not ready the PR, forcing manual finalize.

Recover deterministically: when the actuator commit contributes no tree content
the PR head lacks, converge local HEAD to the fetched PR head (discard the
actuator commit) so exit-`11` auto-ready readies the PR head.

## Decisions

Convergence happens inside the review actuator push-failure handler in
`review.ts`, before exit-`11` propagates — so `completion-pipeline` exit-`11`
auto-ready needs no special casing. (Alternative: detect-and-converge in
`completion-pipeline` — rejected: failure context is local to `review.ts`.)
Non-fast-forward classification: after `withSyncTransientRetry` on `pushCurrent`
exhausts, match the captured push stderr against git non-ff heuristics
(`non-fast-forward`, `failed to push some refs`,
`Updates were rejected because`, `tip of your current branch is behind`).
Distinct from `isTransientNetworkError` (retried) and from other permanent push
errors that fail the heuristic (auth, etc.) — those surface with no
convergence. Rules out unverifiable "classify" with no stderr basis.
Converge only on a classified non-fast-forward rejection.
Convergence eligibility is tree equality: local HEAD tree equals the fetched
PR-head tree (`git rev-parse HEAD^{tree}` on each). Proves the failed actuator
commit is content-redundant on the PR head. Rules out sha-equality with the
recorded gate-green head and linear "sole commit above PR head" framing (both
break under squash/rebase remote advance).
If local HEAD tree ≠ fetched PR-head tree, leave the worktree unchanged and
surface the push failure — no `git reset --hard`. Rules out lossy reset when
the actuator carries net content not on the PR head.
Fetch + reset: `git fetch origin <branch>`; on success,
`git reset --hard` to the fetched tip (`FETCH_HEAD` / post-fetch
`origin/<branch>`), not a possibly stale tracking ref. On fetch failure:
surface unchanged, no reset.
Observability: converge path emits a distinct harness fanout line and telemetry
`exitReason` (e.g. `actuator-push-converged`); surfaced/non-converged path
keeps `actuator-commit-failed`. Rules out one exit reason for both outcomes.
After convergence, exit-`11` auto-ready runs the **`full`** ready tier (HEAD sha
differs from the recorded green carrier even when trees match); if green, the
PR is marked ready. Outcome only — no fast-tier sha-match assumption.
Deferred to first consumer: convergence when multiple actuator commits leave
local HEAD tree ≠ fetched PR-head tree but each individual commit is
tree-redundant — pin when a run exhibits it; this spec covers the
tree-equal / single-failed-push case only.

## Task checklist

- [ ] Add `isNonFastForwardPushError(stderr)` (or equivalent) and use it in the
  `review.ts` actuator commit/push handler after transient retry exhausts.
- [ ] On non-ff classification: fetch `origin/<branch>`; when fetch succeeds and
  local HEAD tree = fetched PR-head tree, `git reset --hard` to the fetched tip;
  otherwise surface the failure unchanged (including fetch failure and tree
  mismatch).
- [ ] Emit distinct fanout + telemetry for converge vs surfaced failure.
- [ ] Tests: tree-equal non-ff converges + exit-`11` auto-ready readies PR head;
  tree-mismatch leaves worktree unchanged; non-ff heuristic distinct from
  transient retry and other permanent push errors; fetch failure surfaces with
  no reset.

## Acceptance criteria

- [x] A non-fast-forward review-actuator push rejection is identified by the
  documented stderr heuristics after transient retry exhausts, not surfaced as
  an unrecovered diverged worktree when trees match.
- [x] When local HEAD tree equals the fetched PR-head tree, the worktree HEAD
  converges to the fetched PR head (actuator commit discarded) and is no longer
  diverged from `origin/<branch>`.
- [x] When local HEAD tree ≠ fetched PR-head tree, the worktree is left
  unchanged, the push failure is surfaced, and convergence observability is not
  emitted.
- [x] On `review-incomplete` (exit `11`) after a converged non-ff actuator
  push, auto-ready readies the PR head; the run still exits `11`.
- [x] A transient push error and a non-fast-forward rejection are handled
  differently: transient retries as before; only a classified non-fast-forward
  rejection attempts convergence.
- [x] Converge and surfaced-failure paths are operator-distinguishable via
  distinct fanout and/or telemetry `exitReason`.

## Documentation updates

- `v2/docs/v1-behaviors.md`: amend the actuator-infra-error (exit `11`) and
  review-incomplete auto-ready bullets — non-ff actuator push rejection
  converges to fetched PR head when trees match; exit-`11` auto-ready then runs
  **`full`** and readies the PR head.
- `v1/docs/run-loop.md`: update the review-incomplete auto-ready section and
  exit-`11` table row — same convergence behavior; remove the implication that
  a tree-equal non-ff actuator push rejection requires manual finalize.
- `v1/docs/operator-runbook.md`: no dedicated rejected-actuator-push bullet
  exists; skip unless a cross-reference is added — primary operator-facing
  recovery text lives in `run-loop.md` exit-`11`.
