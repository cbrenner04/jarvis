# 00 - Deterministic watchdog output-age timing

## Problem

`v1/test/run.sandbox-unrunnable.test.ts` has a wall-clock race in "watchdog timeout records last_output_age_ms from early output then stall": under suite load, the timeout can fire before the scripted early output is observed, so telemetry records `last_output_age_ms: null`.

## Decisions

- Drive the patch-iteration watchdog timeout and `last_output_age_ms` snapshot from one injected deterministic clock/timer in this test; rules out mixed real/fake timing, longer sleeps, wider bounds, or retry loops.
- Preserve watchdog telemetry semantics; rules out treating missing output as a numeric age or otherwise weakening `last_output_age_ms`.
- Keep process-kill coverage on real OS integration tests; rules out converting descendant/process-group assertions to fake-only tests.
- Scope clock injection to the patch watchdog path needed by this test; rules out a broad scheduler rewrite across plan, review, prompt, and shrink flows.
- Keep a local test-only hook documented inline, but document any reusable timing abstraction or durable internal contract in `v2/docs/`; rules out both undocumented architecture and speculative doc churn.

## Task checklist

- Add one test-only clock/timer injection for patch iteration watchdog timeout scheduling and output-age measurement.
- Refactor the early-output-then-stall test to advance deterministic time after output is observed instead of sleeping on wall time.
- Keep the assertion that `last_output_age_ms` is a number and below `iterationTimeoutMs - 500`.
- Preserve existing real process-group watchdog tests.
- Add inline doc-comments for any exported test hook introduced.

## Acceptance criteria

- [x] `v1/test/run.sandbox-unrunnable.test.ts` deterministically records numeric `last_output_age_ms` for the early-output-then-stall patch watchdog timeout using one injected timing source for timeout scheduling and output-age measurement, without real wall-clock sleeps for output/timeout ordering.
- [x] The early-output-then-stall test still fails if telemetry records `last_output_age_ms: null`.
- [x] The early-output-then-stall test still asserts `last_output_age_ms < iterationTimeoutMs - 500`.
- [x] `v1/test/run.sandbox-unrunnable.test.ts` watchdog process-group and descendant-kill integration tests stay green.
- [x] `bun run typecheck` passes.
- [x] `bun run test` passes.

## Documentation updates

- If the change stays a local test-only hook, add inline doc-comments for exported hooks and no durable docs.
- If the change introduces a reusable timing abstraction or durable internal contract, update its durable `v2/docs/` home per `v2/docs/documentation-standard.md`.
