# Bound shrink sandbox-unrunnable stall cleanup

## Problem

`v1/test/modes/patch/shrink.sandbox-unrunnable.test.ts` can leave CI waiting on
real git subprocesses or owned idle-hang fixtures instead of failing as a test.

## Decisions

- Fix the shrink test path itself — rules out masking the stall with a job-level CI timeout.
- Bound every real git subprocess this file owns — rules out bare synchronous git calls that can block forever.
- Reap every hang fixture this file owns on success and failure — rules out relying on process exit or best-effort `afterEach` cleanup alone.
- Keep sibling `*.sandbox-unrunnable.test.ts` audits out of scope here — rules out widening this subspec into a multi-file hardening pass.
- Document the post-fix operator-visible behavior in `v1/docs/operator-runbook.md` and `v2/docs/v1-behaviors.md` — rules out landing an observable harness change with doc drift.
- Deferred to first consumer: a shared bounded-subprocess helper for other sandbox-unrunnable suites — pin when a second caller needs the same contract.

## Task checklist

- [ ] Characterize the shrink stall path well enough to identify every real git subprocess and owned idle-hang fixture that can block this file.
- [ ] Harden `v1/test/modes/patch/shrink.sandbox-unrunnable.test.ts` so its owned subprocess and fixture stall paths fail within a bounded time and reap cleanly.
- [ ] Keep the failure as a red test in this file instead of an indefinitely running CI `Test` step.
- [ ] Update the durable docs listed below in the same change.

## Acceptance criteria

- [ ] A stalled case in `v1/test/modes/patch/shrink.sandbox-unrunnable.test.ts` fails as a bounded test failure instead of hanging the CI `Test` job indefinitely.
- [ ] Every real git subprocess owned by the shrink sandbox-unrunnable path is started with a bounded-failure contract, so no owned git call on that path can block the file forever.
- [ ] Every idle-hang fixture child owned by `shrink.sandbox-unrunnable.test.ts` is reaped when the bounded failure fires, including failure paths that exit before normal test cleanup.
- [ ] The hardened shrink file still exercises the real shrink-path stall behavior rather than replacing it with a workflow-level CI timeout or a fully mocked path.
- [ ] `v1/docs/operator-runbook.md` records the post-fix operator guidance for transient `*.sandbox-unrunnable.test.ts` stalls, including that the shrink file now fails boundedly instead of wedging the test job.
- [ ] `v2/docs/v1-behaviors.md` records that shrink sandbox-unrunnable stalls now fail boundedly with cleanup instead of hanging the test job.

## Documentation updates

- `v1/docs/operator-runbook.md` — update the transient `*.sandbox-unrunnable.test.ts` gotcha/retry guidance to the bounded-failure behavior.
- `v2/docs/v1-behaviors.md` — record the shrink sandbox-unrunnable bounded-failure behavior as the shipped v1 baseline.
