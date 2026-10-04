# 00 - Arm the idle watchdog on write-step invocations and settle `idle_output_timeout`

## Problem

`resolveWritePathIterationBounds` validates `idleOutputTimeoutMs` but returns only the wall and
ceiling, so no write-path `executeWithQuotaFallback` call site passes `idleOutputMs`. A silent
implement / plan-draft / intent-split agent rides the full progress-extended wall and reports
`iteration_timeout`, which is indistinguishable from a genuinely slow-but-working agent in
`run list`.

## Decisions

- `resolveWritePathIterationBounds` returns `idleOutputMs` alongside the wall and ceiling, and omits the key when `idleOutputTimeoutMs` is `0`; rules out a separate loader call at each dispatch site and preserves v1 disable semantics through the existing single spread into write steps.
- Name the plumbed field `idleOutputMs` on `WriteLoopInput` / write steps / `WriteExecuteInput`, matching shared invocation; rules out a third spelling on the way from config (`idleOutputTimeoutMs`) to the binding.
- Persist `idleOutputMs` on the workflow-snapshot write step and rehydrate it on daemon resume, as wall and ceiling already are; rules out a resumed run silently losing the watchdog.
- The primary `runStep` invocation classifies `result.kind === "stall"` as a new `StepRunResult` kind distinct from `invocation_failure`; rules out routing through `INVOCATION_BY_FAILURE_KIND.stall`, which advertises review's retryable `role_stalled`.
- New outcome kind `idle_output_timeout` in the attempt `OutcomeKind`, write-loop outcome kinds, and workflow step terminal outcomes; run status `failed`, exit code parity with `iteration_timeout`; rules out reusing `iteration_timeout` or `invocation_failure` for a fast idle kill.
- Operator error: reason `idle_output_timeout`, `retryable: false`, `nextAction: "stop"`, mapped from both the committed attempt and `loop_finished`; rules out inheriting review's `retry_later`.
- Attribute the failure with the settled binding's `agent` and `model` plus the idle `boundMs`, reusing the existing `InvocationFailureDetail` fields on the attempt; rules out a parallel attribution record.

## Acceptance criteria

- [x] A write-loop test drives a silent agent under an idle budget far below the iteration wall and asserts the iteration settles `idle_output_timeout` (not `iteration_timeout`) before the wall could elapse; it fails against the pre-fix code.
- [x] `run list` / `run wait` report `outcomeKind` and `error.reason` `idle_output_timeout` with `retryable: false` and `nextAction: "stop"`, and the attempt carries the settled agent, model, and the idle bound that fired.
- [x] A plan-draft workflow test and an intent-split workflow test each drive a silent agent and assert `idle_output_timeout`, not `iteration_timeout`.
- [x] A write-loop test drives a healthy iteration that emits output and completes, and asserts no stall and no timeout outcome.
- [x] With `idleOutputTimeoutMs: 0` in machine config, a silent write iteration produces no `idle_output_timeout`: the watchdog is absent and the run settles on the wall instead — inverting the disable guard (arming anyway) fails this test.
- [x] A resumed workflow write step rehydrated from its snapshot is still armed: a silent agent on resume settles `idle_output_timeout`.

## Documentation updates

- `v2/docs/write-behavior.md` — idle budget alongside the progress-extended wall and ceiling; which bound fires when; `idle_output_timeout` boundary and status.
- `v2/docs/daemon-host.md` — `idle_output_timeout` outcome: reason, retryability, `nextAction`.
- `v2/docs/install-and-config.md` — `idleOutputTimeoutMs` is armed on the write path; `0` disables; ordering with wall and ceiling (replace the "not yet armed" note).
- `v2/docs/operator-runbook.md` — drop the claim that v2 write has no idle-output watchdog.
- `v2/docs/v1-behaviors.md` — v2 write-loop idle-output watchdog parity with v1.
