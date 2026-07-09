# Thin duplicate and supersetted coverage in write-loop.test.ts

`v2/src/execution/write-loop.test.ts` has four thinning targets, all in the
`describe("write loop", ...)` block:

1. Crash-resume pair A: `re-invoking an interrupted run re-runs that
   iteration over the dirty worktree` (no sink) and `kill/crash resume
   re-run emits a fresh iteration_started for the interrupted attempt` (with
   sink) exercise the same crash-then-resume-over-dirty-worktree scenario.
2. Crash-resume pair B: `re-running a boundary that fails mid-transaction
   retries the same attempt without duplicate history` (no sink) and
   `mid-boundary rollback emits iteration_started, no boundary_committed on
   failed attempt, retry with same attemptId, then success` (with sink)
   exercise the same mid-boundary-crash-then-retry scenario.
3. Three abort tests: `cancellation propagates via AbortSignal` (no sink),
   `abort/cancellation emits paired iteration_started / boundary_committed
   for each completed iteration plus loop_finished` (with sink, full event
   sequence), and `abort signal path unchanged: aborts stop the loop without
   committing the in-flight boundary` (with sink, store-attempt assertions).
   The last two's assertions between them cover everything the first
   asserts.
4. Byte-for-byte duplicate: `omitting the log sink leaves loop behavior
   unchanged` is an identical body (setup, bindings, assertions) to `calls
   executeWrite repeatedly until terminal`, just without a sink — the sink
   arg is optional on `runLoop`, so the no-sink path is already exercised by
   the earlier test.
5. Terminal-mapping quartet: `terminal boundary_committed and loop_finished
   payloads match terminalMapping for blocked outcome`, `... for
   contract_miss outcome`, `... for invocation_failure outcome`, and `... for
   no-work outcome` differ only in the bindings passed in and the expected
   outcome/status values.

## Decisions

- Merge each with/without-sink pair into one test that always passes a
  `logSink` and keeps every distinct assertion from both originals.
- Collapse the three abort tests into one test (with sink) that keeps every
  distinct assertion across all three: `result.kind`/`iterationsConsumed`/
  `resumable`, the full event-kind sequence plus final event fields, and the
  state-store attempt statuses.
- Delete `omitting the log sink leaves loop behavior unchanged` entirely;
  `calls executeWrite repeatedly until terminal` is its surviving owner.
- Replace the terminal-mapping quartet with one test iterating a table of
  `{ label, bindings, expectedResultKind, expectedBoundaryOutcomeKind,
  expectedBoundaryRunStatus?, expectedFinishedOutcomeKind }` rows, one row
  per current test case, asserting the same fields each original test
  asserted.

## Out of scope

- Any change to `write-loop.ts` or other non-test source.
- Dropping crash-resume or abort coverage itself — only the duplicated
  cases collapse; every distinct assertion from a removed test must survive
  in its merged replacement.

## Task checklist

- [ ] Merge crash-resume pair A into one sink-backed test.
- [ ] Merge crash-resume pair B into one sink-backed test.
- [ ] Collapse the three abort tests into one.
- [ ] Delete the byte-for-byte duplicate test.
- [ ] Table-drive the terminal-mapping quartet.

## Acceptance criteria

- [ ] `write-loop.test.ts` has one test covering the crash-resume-over-dirty-worktree scenario (pair A), asserting both the resumed-worktree content and the event/attemptId behavior the two originals covered.
- [ ] `write-loop.test.ts` has one test covering the mid-boundary-crash-then-retry scenario (pair B), asserting both the attempt-count/history behavior and the event/attemptId behavior the two originals covered.
- [ ] `write-loop.test.ts` has one abort/cancellation test asserting `result.kind`, `iterationsConsumed`, `resumable`, the full event-kind sequence, the final event's `loopOutcomeKind`, and the state-store attempt statuses.
- [ ] `write-loop.test.ts` no longer contains a test named `omitting the log sink leaves loop behavior unchanged`.
- [ ] `write-loop.test.ts` has one table-driven test replacing the four `terminal boundary_committed and loop_finished payloads match terminalMapping for <outcome> outcome` tests, covering all four outcome cases (blocked, contract_miss, invocation_failure, no-work).
- [ ] `bun test v2/src/execution/write-loop.test.ts` passes.
- [ ] PR body states the test-count diff vs baseline and names each removed test with its surviving owner/replacement.

## Documentation updates

None — test-only change, no operator-facing or v1-behavior change.
