# A stalled review role discards a committed write step

## Problem

`role_stalled` settles `retryable: false` / `nextAction: "stop"` / `resumable: false`, so a review
role that goes quiet destroys the value of a *completed and committed* implement write step. The
workflow dies before publication: the completion commit sits in the worktree, nothing is pushed, no
PR exists, and the row's own remediation is "stop".

This is the same state `preserve-committed-work-when-review-step-fails` (#2003) fixed for
`failureKind: "timeout"`. That spec scoped itself deliberately — "Only `failureKind: "timeout"`
changes" — and the idle-output watchdog that *introduces* `failureKind: "stall"` (#1998) shipped in
the same session. So the stall path never got the recovery its sibling did, even though the property
that justified the fix holds identically: on a post-commit stall the completion commit and any
adjudicated verdict both survive on disk.

Observed 2026-07-23, **four times across three specs in one session**, every one of them a clean
one-iteration write step:

```text
cf6e46f3-…  20260723T132247Z-timer-callback-guard-extraction-fixture     failed  role_stalled  false  stop
39d42e45-…  20260723T132247Z-timer-callback-guard-extraction-fixture     failed  role_stalled  false  stop
d6727a38-…  20260723T132234Z-coverage-advisory-finishes-inside-write-step failed  role_stalled  false  stop
d14e266b-…  20260723T132244Z-resume-accepts-landing-failed               failed  role_stalled  false  stop
```

Each left its worktree at a real completion commit (e.g. `3020676c`, `e9e1a130`, `57d2c780`) with
nothing on the remote. The timer fixture hit it twice: a plain re-dispatch stalled again, so
re-dispatch alone is not the recovery here the way it is for `role_timeout`. The session's actual
recourse was `--review-passes 0` on every remaining implement — dropping review entirely, which is
precisely the recourse #2003 exists to eliminate.

## Decisions

- `failureKind: "stall"` settles like `failureKind: "timeout"` does after #2003: `resumable: true`,
  `retryable: true`, `nextAction: "retry_later"`, commit and verdict preserved. Rules out leaving
  `--review-passes 0` as the operator's answer to a quiet actuator.
- Keep the row `failed` / `invocation_failure` with its existing stall attribution; only
  `resumable` and the composed operator error change. Rules out demoting to `paused`, for the same
  reason #2003 gave — `reconstructWriteResume` rejects review steps.
- `error`, `quota`, `model_config`, `no_binding`, and `landing` failure kinds keep today's settle.
  Rules out reworking every invocation-failure path under a stall-recovery change.
- Pin the shared property rather than adding a second one-kind special case: the failure kinds that
  occur *after* a committed write step and leave it intact must agree on retryability, so a third
  such kind cannot drift the way `stall` did from `timeout`. Rules out copying the `timeout` branch
  and moving on.
- Out of scope: making the actuator stop stalling. This seed is about not throwing away committed
  work when it does; why cursor's review roles go quiet is a separate question.

## Acceptance criteria

- [ ] A `workflow-runner.test.ts` case drives an actuator role **stall** after a committed implement
      write step against a real git fixture and asserts the completion commit is still `HEAD` and any
      verdict file still holds its content; it fails against the pre-fix code.
- [ ] A stalled review step reports `resumable: true`, and `run list` / `run wait` report
      `error.reason: "role_stalled"` with `retryable: true` and `nextAction: "retry_later"`.
- [ ] Re-dispatching the same workflow after a stalled review reuses the completed write step's
      checkpoint and re-invokes no write-step agent.
- [ ] A guard pins the general property: every review failure kind that can occur after a committed
      write step and preserves it reports the same retryability as `role_timeout`; inverting it fails.
- [ ] `invocation_failure` with `failureKind: "error"` still settles `invocation_error`,
      `retryable: false`, `nextAction: "stop"`, `resumable: false` — the negative case proves the
      change did not make every review failure retryable.
- [ ] `review-cycle.test.ts`, `review-debate.test.ts`, and existing `workflow-runner.test.ts` review
      cases stay green.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — a stalled review settle is resumable/retryable and preserves the
  commit and verdict, matching the timeout path.
- `v2/docs/daemon-host.md` — `role_stalled` row: `retryable: true`, `nextAction: retry_later`.
- `v2/docs/operator-runbook.md` § Gate trust — correct the current claim that `role_stalled` is
  non-retryable/stop; recovery is re-dispatch, as with `role_timeout`.
- `v2/docs/v1-behaviors.md` — review-step settle behavior on a post-commit role stall.

## Prerequisites

- The idle-output watchdog settles review-role invocations `invocation_failure` with
  `failureKind: "stall"` (#1998).
- The timeout path already settles retryable and preserves the commit and verdict (#2003).
