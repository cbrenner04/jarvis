# 00 - Settle a timed-out review step as retryable, preserving the commit and verdict

## Problem

`runReviewDebateStep`, `runProfileReviewStep`, and `standardReviewRoleFailureOutcome` all return
`resumable: false` for every review-role failure, and `run-operator-error.ts` maps
`failureKind: "timeout"` to `role_timeout` / `nextAction: "stop"` / `retryable: false`. A role
invocation that merely exceeded its bound therefore reports as a dead end even though the implement
write step's completion commit and the adjudicated verdict both survive on disk. The observed
recourse was re-running with `--review-passes 0`, dropping review entirely.

## Decisions

- Only `failureKind: "timeout"` changes; `error`, `quota`, `model_config`, `no_binding`, and
  `landing` keep today's settle — rules out reworking every invocation-failure path under a
  timeout-recovery change.
- The review run row stays `failed` / `invocation_failure` with the existing timeout attribution;
  only `resumable` and the composed operator error change — rules out demoting the row to `paused`,
  which would synthesize a write-resume context the review step cannot satisfy.
- `role_timeout` maps to `nextAction: "retry_later"`, `retryable: true` — rules out `"resume"`,
  because `reconstructWriteResume` rejects review steps and `run resume` would answer
  `unsupported_resume_context`.
- The workflow still returns at the failed review step and publishes nothing — rules out treating a
  half-applied review as complete and auto-landing the PR.
- Recovery is re-dispatching the same workflow: the completed write step's checkpoint is reused, so
  the implementation is not re-run. No new checkpoint kind is introduced.
- The verdict file is left where the debate wrote it; nothing truncates or deletes it on the timeout
  path — rules out folding verdict capture into the run row.

## Acceptance criteria

- [x] A new `workflow-runner.test.ts` case drives an actuator role timeout after a committed
      implement write step against a real git fixture and asserts the completion commit is still
      `HEAD` and the adjudicated verdict file still holds the adjudicator's output; it fails against
      the pre-fix code.
- [x] A timed-out review step reports `resumable: true`, and `run list` / `run wait` report
      `error.reason: "role_timeout"` with `retryable: true` and `nextAction: "retry_later"`.
- [x] Re-dispatching the same workflow after a timed-out review reuses the completed write step's
      checkpoint and re-invokes no write-step agent.
- [x] A review step whose roles all complete settles exactly as before: `review-cycle.test.ts`,
      `review-debate.test.ts`, and the existing `workflow-runner.test.ts` review cases stay green.
- [x] A review-role `invocation_failure` with `failureKind: "error"` still settles
      `invocation_error`, `retryable: false`, `nextAction: "stop"`, `resumable: false`
      (`run-operator-error.test.ts` failure-kind table).
- [x] Tests pin every added or modified guard in both directions so inverting any guard fails; the
      negative case proves a non-timeout review failure gains neither resumability nor a retryable
      operator error.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — review dispatch: a timeout settle is resumable/retryable and
  preserves the commit and verdict; other role failures unchanged.
- `v2/docs/daemon-host.md` — `role_timeout` row: `retryable: true`, `nextAction: retry_later`.
- `v2/docs/operator-runbook.md` § Gate trust — recovering a timed-out review step by re-dispatching
  the workflow.
- `v2/docs/v1-behaviors.md` — updated review-step settle behavior on a post-commit role timeout.
