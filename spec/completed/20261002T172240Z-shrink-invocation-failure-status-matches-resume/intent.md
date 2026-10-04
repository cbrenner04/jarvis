---
name: shrink-invocation-failure-status-matches-resume
---

# A shrink invocation failure never strands a paused row that resume refuses

Unsplit rationale: one execution-loop surface (`settlePostCommitShrinkForResume` post-commit shrink settlement); `resolveRunResumeAdmission` already admits from the chronologically last `loop_finished` once the log is corrected.

## Primary implementation surface

- `v2/src/execution/workflow-runner.ts` (`settlePostCommitShrinkForResume` / `isPostCommitShrinkResumableOutcome`)

## Problem

Post-commit `implement~shrink` `invocation_failure` with `failureKind: "error"` is treated as resumable and leaves the row `paused`, but only `contract_miss` / `blocked` get a corrective `loop_finished` with `resumable: true`. The shrink row log still ends `loop_finished invocation_failure resumable: false`, so `jarvis run resume` composes `invocation_error` / `stop` and refuses while the row stays `paused` (no retention age-out, worktree held, review-feedback blocked). Latent since #2213; run `3dd4be83` (2026-10-02).

## Decisions

- Prefer resumable: append corrective `loop_finished resumable: true` for post-commit shrink `invocation_failure` (`failureKind: "error"`) like `contract_miss` / `blocked`, so `run resume` re-enters at `implement~shrink` without re-invoking implement.
- Alternative terminal `failed` (no `paused`) is acceptable only if plan rejects resumable; default is resumable.
- Quota, `model_config`, `no_binding`, and other shrink failure kinds keep existing classifications.

## Prerequisites

## Acceptance criteria

- [ ] `workflow-runner.test.ts` `post-commit shrink invocation_failure error is resumable` (mirror `post-commit shrink contract_miss is resumable`) drives implement→commit→shrink `invocation_failure` (`failureKind: "error"`) and asserts `implement~shrink` `paused`, terminal `loop_finished` `resumable: true`, and `resolveRunResumeAdmission` admitted (re-enter `implement~shrink`); never `paused` with admission refused; fails against current code (`settlePostCommitShrinkForResume` omits the corrective append for `invocation_failure`).
- [ ] `workflow-runner-core.test.ts` `resumes a shrink invocation error without re-invoking implement and publishes after shrink completes` stays green after the fix.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Publication / completion failures: extend the post-commit shrink `contract_miss` resume bullet with the same `jarvis run resume` on `implement~shrink` for `invocation_failure` (`failureKind: "error"`); omit if plan confirms no runbook edit is needed (§ Clearing a stale non-active run has no shrink-specific force-kill workaround on main).
- `v2/docs/workflow-runner.md`: extend the corrective `loop_finished` sentence to include post-commit shrink `invocation_failure` (`failureKind: "error"`) alongside `contract_miss` and text-less `blocked`; do not restate resumability (already claimed there).
- `v2/docs/v1-behaviors.md`: record that shrink `invocation_error` after a committed implement write matches list/wait/resume admission (no stranded `paused` + refused resume).
