# 01 - Write-loop surfaces executeWrite throws

## Problem

`executeWriteLoop` calls `await executeWrite(...)` (`v2/src/execution/write-loop.ts:171-173`) with no catch. A throw inside `executeWrite` — the ENOENT in 00, or any future pre-spawn failure — escapes the loop, leaving the run `in-progress` with `iteration_started` as its last event and no terminal reason. That is why a one-line path bug presented as an indefinite stall: the loop had no way to report a failure that happened before the agent was reached.

Fixing 00 removes today's trigger; this subspec removes the failure *mode*, so the next pre-spawn throw fails loudly instead of wedging.

## Decisions

- Catch throws from `executeWrite` and terminate the attempt with a named failure reason carrying the error message — rules out letting the rejection propagate out of `executeWriteLoop` (today's wedge) and rules out swallowing it into a silent retry, which would burn every attempt against a deterministic error.
- Treat a pre-spawn throw as non-retryable within the loop — rules out re-running an attempt whose failure cannot vary between iterations.

## Acceptance criteria

- [ ] A write loop whose `executeWrite` throws terminates the run with a failure reason naming the error, instead of the run remaining active after `iteration_started`.
- [ ] The structured log for that run records a terminal event after `iteration_started`; the run is no longer reported as active.
- [ ] A throwing `executeWrite` produces exactly one `iteration_started` — the loop does not retry it.
- [ ] Existing `v2/src/execution/write-loop.test.ts` tests stay green (success and contract-failure paths unchanged).

## Documentation updates

- `v2/docs/workflow-runner.md` — write-loop failure semantics: a write step that fails before invoking its agent ends the run with a named reason rather than leaving it active.
