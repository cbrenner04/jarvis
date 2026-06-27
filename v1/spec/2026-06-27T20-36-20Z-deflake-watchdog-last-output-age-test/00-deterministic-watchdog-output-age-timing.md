# 00 - Deterministic watchdog output-age timing

## Problem

`v1/test/run.sandbox-unrunnable.test.ts` has a wall-clock race in "watchdog timeout records last_output_age_ms from early output then stall": under suite load, the timeout can fire before the scripted early output is observed, so telemetry records `last_output_age_ms: null`.

## Decisions

- Drive this test through injected deterministic time; rules out longer real sleeps, wider bounds, or retry loops.
- Preserve watchdog telemetry semantics; rules out treating missing output as a numeric age or otherwise weakening `last_output_age_ms`.
- Keep process-kill coverage on real OS integration tests; rules out converting descendant/process-group assertions to fake-only tests.
- Scope clock injection to the patch watchdog path needed by this test; rules out a broad scheduler rewrite across plan, review, prompt, and shrink flows.
- Do not update durable operator docs when behavior stays unchanged; rules out v1/v2 doc churn for test-only determinism.

## Task checklist

- Add a test-only clock/timer injection for patch iteration watchdog timing.
- Refactor the early-output-then-stall test to advance deterministic time after output is observed instead of sleeping on wall time.
- Keep the assertion that `last_output_age_ms` is a number and meaningfully below `iterationTimeoutMs`.
- Preserve existing real process-group watchdog tests.
- Add inline doc-comments for any exported test hook introduced.

## Acceptance criteria

- [ ] `v1/test/run.sandbox-unrunnable.test.ts` deterministically records numeric `last_output_age_ms` for the early-output-then-stall watchdog timeout without relying on real wall-clock sleeps for the output/timeout ordering.
- [ ] The early-output-then-stall test still fails if telemetry records `last_output_age_ms: null`.
- [ ] Existing watchdog process-group and descendant-kill integration assertions in `v1/test/run.sandbox-unrunnable.test.ts` remain real OS coverage.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test` passes.

## Documentation updates

- No durable operator docs required if runtime watchdog behavior is unchanged.
- Add inline doc-comments for exported test-only clock/timer hooks, if any.
