# 00 - Settle a stalled review step as retryable, preserving the commit and verdict

## Problem

`run-operator-error.ts` maps `failureKind: "stall"` to `role_stalled` / `nextAction: "stop"` /
`retryable: false`, and review-step settle paths set `resumable` only for `failureKind: "timeout"`. A
quiet actuator after the implement write step already committed therefore reports a dead end even though
the completion commit and adjudicated verdict remain on disk — the same failure mode
`preserve-committed-work-when-review-step-fails` fixed for wall-clock timeout.

## Decisions

- Post-commit `failureKind: "stall"` settles like post-commit `failureKind: "timeout"`: `resumable: true`,
  `retryable: true`, `nextAction: "retry_later"`, commit and verdict preserved — rules out
  `--review-passes 0` as the operator answer to a quiet actuator.
- Run row stays `failed` / `invocation_failure` with existing stall attribution; only `resumable` and
  composed operator error change — rules out `paused`, because `reconstructWriteResume` rejects review
  steps.
- `error`, `quota`, `model_config`, `no_binding`, and `landing` failure kinds keep today's settle — rules
  out reworking every invocation-failure path under this change.
- Post-commit review `failureKind: "timeout"` and `failureKind: "stall"` share one retryability settle
  path with `role_timeout` — rules out a per-stall branch; `quota`, `error`, and other kinds stay on the
  prior decision's settle.
- Recovery is re-dispatching the same workflow: the completed write step's checkpoint is reused; no new
  checkpoint kind — rules out `run resume` on a review step (`unsupported_resume_context`).
- Out of scope: preventing review roles from stalling.

## Acceptance criteria

- [ ] A new `workflow-runner.test.ts` case drives an actuator role stall after a committed implement write
      step against a real git fixture and asserts the completion commit is still `HEAD` and the adjudicated
      verdict file still holds its content; it fails against the pre-fix code.
- [ ] A stalled review step reports `resumable: true`, and `run list` / `run wait` report
      `error.reason: "role_stalled"` with `retryable: true` and `nextAction: "retry_later"`.
- [ ] Re-dispatching the same workflow after a stalled review reuses the completed write step's checkpoint
      and re-invokes no write-step agent.
- [ ] A guard on the shared post-commit review retryability settle path asserts `timeout` and `stall` both
      yield `resumable: true` and operator errors with `retryable: true` and `nextAction: "retry_later"`;
      inverting the guard fails.
- [ ] A review-role `invocation_failure` with `failureKind: "error"` still settles `invocation_error`,
      `retryable: false`, `nextAction: "stop"`, `resumable: false` (`run-operator-error.test.ts`
      failure-kind table).
- [ ] `review-cycle.test.ts`, `review-debate.test.ts`, and existing `workflow-runner.test.ts` review cases
      stay green.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — stalled review settle is resumable/retryable and preserves commit and
  verdict, matching the timeout path.
- `v2/docs/daemon-host.md` — `role_stalled` row: `retryable: true`, `nextAction: retry_later`.
- `v2/docs/operator-runbook.md` § Gate trust — `role_stalled` recovery is re-dispatch, as with
  `role_timeout`.
- `v2/docs/v1-behaviors.md` — review-step settle behavior on a post-commit role stall.
