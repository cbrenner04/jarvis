---
name: shrink-invocation-failure-status-matches-resume
---

# A shrink invocation failure never strands a paused row that resume refuses

## Problem

`settlePostCommitShrinkForResume` (`v2/src/execution/workflow-runner.ts` ~:400-414) treats a post-commit `implement~shrink` `invocation_failure` with `failureKind: "error"` as resumable (`isPostCommitShrinkResumableOutcome`, ~:385-398) and sets the row `paused` (~:405), but appends a corrected `loop_finished resumable: true` only for `contract_miss`/`blocked` (~:406). The log still ends `loop_finished invocation_failure resumable: false`, so `jarvis run resume` maps it to `invocation_error`/`stop` (`v2/src/daemon/run-operator-error.ts` ~:172; `daemon-run-resume-admission.ts` ~:77) and refuses `terminal_run`. The row stays `paused` forever: never ages out, holds the worktree, blocks review-feedback (`review_feedback_lane_in_flight`). Latent since #2213.

## Evidence

- 2026-10-02 run `3dd4be83` (ready-repair allowed-paths): cursor shrink exited 143 after 963 s; row `paused`, `run-paused` incident fired, resume refused; operator cleared with `run kill --force` and re-dispatched.

## Decisions

- Status and resume admission agree: a shrink `invocation_failure(error)` either appends `loop_finished resumable: true` so `run resume` re-enters at `implement~shrink`, or settles terminally `failed` (no `paused`). Plan picks; prefer resumable (shrink is post-commit; the implement work is already committed).

## Acceptance criteria

- [ ] `workflow-runner*.test.ts`: a shrink invocation failure (`failureKind: "error"`) produces a row whose status and `resolveRunResumeAdmission` agree — admitted and re-entering `implement~shrink`, or terminal `failed`; never `paused` + refused. Fails against current code.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Clearing a stale non-active run: drop the shrink-specific case once fixed.
