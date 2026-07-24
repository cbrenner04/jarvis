---
name: preserve-committed-work-when-review-step-stalls
---

# Preserve committed work when a review step stalls

## Problem

`role_stalled` settles `retryable: false` / `nextAction: "stop"` / `resumable: false`, so a quiet review
actuator after a committed implement write step destroys recoverable work. The completion commit and
adjudicated verdict remain on disk; the operator's recourse is `--review-passes 0`, same failure mode
`preserve-committed-work-when-review-step-fails` fixed for `failureKind: "timeout"`.

## Decisions

- `failureKind: "stall"` settles like post-commit `failureKind: "timeout"`: `resumable: true`, `retryable: true`, `nextAction: "retry_later"`, commit and verdict preserved — rules out leaving `--review-passes 0` as the operator answer to a quiet actuator.
- Row stays `failed` / `invocation_failure` with existing stall attribution; only `resumable` and composed operator error change — rules out `paused`, because `reconstructWriteResume` rejects review steps.
- `error`, `quota`, `model_config`, `no_binding`, and `landing` failure kinds keep today's settle — rules out reworking every invocation-failure path under this change.
- Post-commit review `failureKind: "timeout"` and `failureKind: "stall"` share one retryability settle path with `role_timeout` — rules out a per-stall branch; `quota`, `error`, and other kinds stay on decision 3's settle.
- Out of scope: preventing review roles from stalling.

## Acceptance criteria

- [ ] A `workflow-runner.test.ts` case drives an actuator role **stall** after a committed implement write step against a real git fixture and asserts the completion commit is still `HEAD` and any verdict file still holds its content; it fails against the pre-fix code.
- [ ] A stalled review step reports `resumable: true`, and `run list` / `run wait` report `error.reason: "role_stalled"` with `retryable: true` and `nextAction: "retry_later"`.
- [ ] Re-dispatching the same workflow after a stalled review reuses the completed write step's checkpoint and re-invokes no write-step agent.
- [ ] A guard on that shared settle path asserts `timeout` and `stall` both report `retryable: true`, `nextAction: "retry_later"`, and `resumable: true`; inverting it fails.
- [ ] A review-role `invocation_failure` with `failureKind: "error"` still settles `invocation_error`, `retryable: false`, `nextAction: "stop"`, `resumable: false` (`run-operator-error.test.ts` failure-kind table).
- [ ] `review-cycle.test.ts`, `review-debate.test.ts`, and existing `workflow-runner.test.ts` review cases stay green.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — stalled review settle is resumable/retryable and preserves commit and verdict, matching the timeout path.
- `v2/docs/daemon-host.md` — `role_stalled` row: `retryable: true`, `nextAction: retry_later`.
- `v2/docs/operator-runbook.md` § Gate trust — `role_stalled` recovery is re-dispatch, as with `role_timeout`.
- `v2/docs/v1-behaviors.md` — review-step settle behavior on a post-commit role stall.

## Prerequisites

- Review-role idle-output watchdog settles `invocation_failure` with `failureKind: "stall"` and `error.reason: "role_stalled"`.
- A timed-out review step after a committed implement write settles `resumable: true` with `role_timeout` / `retry_later` and preserves the completion commit and verdict.
