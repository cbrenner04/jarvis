# 01 - Write-loop surfaces executeWrite throws

## Problem

`executeWriteLoop` calls `await executeWrite(...)` (`v2/src/execution/write-loop.ts:171-173`) with no catch. A throw inside `executeWrite` — the ENOENT in 00, or any future pre-spawn failure — escapes the loop, leaving the run `in-progress` with `iteration_started` as its last event, an attempt open with no completion boundary, and no terminal reason. That is why a one-line path bug presented as an indefinite stall.

Fixing 00 removes today's trigger; this subspec removes the failure *mode*, so the next pre-spawn throw fails loudly instead of wedging.

## Decisions

- Catch throws from `executeWrite` and terminate through the loop's existing failure vocabulary: `commitCompletionBoundary({ runStatus: "failed", outcomeKind: "invocation_failure", invocationFailureDetail: { failureKind: "error", bindingAttempts: [] } })`, then return `WriteLoopResult.kind: "invocation_failure"` — rules out minting a new outcome kind that daemon/TUI/operator-error mapping would not recognize, and rules out letting the rejection escape `executeWriteLoop` (today's wedge).
- Emit the existing `run_execution_failed` log event for the throw, extended with an optional `message` carrying the error message, in place of `loop_finished` — rules out a terminal event that names no cause; `run-operator-error.ts` already maps this event to a stop-class harness failure.
- Close the open attempt on the throw path via that same completion boundary — rules out leaving a started attempt with no boundary, which is what makes the run look active.
- `resumable: false` — rules out a resumable run, which would contradict the non-retryable decision below.
- Treat a pre-spawn throw as non-retryable within the loop — rules out re-running an attempt whose failure cannot vary between iterations.
- An abort observed concurrently with a pre-spawn throw wins (the post-`await` abort check runs before the throw is converted to a terminal failure) — rules out the two paths disagreeing about the run's terminal state.

## Acceptance criteria

- [ ] A write loop whose `executeWrite` throws returns `invocation_failure` with `failureKind: "error"` and `resumable: false`, and the run's stored status is `failed` with its attempt closed at an `invocation_failure` completion boundary.
- [ ] The structured log for that run records a `run_execution_failed` event carrying the thrown error's message after `iteration_started`; the run is no longer reported as active.
- [ ] A throwing `executeWrite` produces exactly one `iteration_started` — the loop does not retry it.
- [ ] A write loop aborted while `executeWrite` throws terminates as an abort (`progress`, resumable), not as `invocation_failure`.
- [ ] Existing `v2/src/execution/write-loop.test.ts` tests stay green.

## Documentation updates

- `v2/docs/workflow-runner.md` — write-loop failure semantics: a write step that fails before invoking its agent ends the run `failed` (`invocation_failure`, non-resumable) with a `run_execution_failed` event naming the error.
- `v2/docs/v1-behaviors.md` — write-loop terminal behavior on a pre-spawn throw.
