# 01 - Report an idle-output kill as its own operator stop reason

## Problem

`INVOCATION_BY_FAILURE_KIND` in `v2/src/daemon/run-operator-error.ts` has no `stall` entry, so once
subspec 00 arms the budget an idle-output kill falls through to the generic
`op("invocation_error", "stop")`. On the run row an idle kill would then read the same as any agent
error, and the distinction the watchdog exists to make stops at the execution layer.

## Decisions

- Map `failureKind: "stall"` to its own operator reason `role_stalled` (`retryable: false`,
  `nextAction: "stop"`); rules out folding it into `invocation_error` (hides the hang) and into
  `role_timeout` (conflates idle with wall clock).
- Non-retryable/stop, matching `role_timeout`; rules out `resume`, which would re-spawn a hung
  actuator against the same binding.

## Acceptance criteria

- [x] A run whose last attempt is `invocation_failure` with `failureKind: "stall"` reports
      `error.reason: "role_stalled"` with `retryable: false` and `nextAction: "stop"` from
      `jarvis run list` / `wait`.
- [x] A `failureKind: "timeout"` attempt still reports `role_timeout`, and a `failureKind: "error"`
      attempt still reports `invocation_error`.
- [x] A new test in `v2/src/daemon/run-operator-error.test.ts` covers the `stall` mapping and fails
      against the pre-fix mapping (which yields `invocation_error`).
- [x] Tests pin every added or modified guard in both directions so inverting any guard fails; where
      a guard suppresses an effect, the negative case proves the effect is absent.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — operator-error table gains the `role_stalled` row.
- `v2/docs/operator-runbook.md` — extend the role-timeout paragraph preceding § Gate trust: reading
  an idle-output kill (`role_stalled`) vs a wall-clock abort (`role_timeout`) vs write-loop
  `iteration_timeout`.
- `v2/docs/v1-behaviors.md` — review role invocations now carry an idle-output bound (default
  90_000 ms, v1 parity) surfacing as `failureKind: "stall"` / `role_stalled`.
