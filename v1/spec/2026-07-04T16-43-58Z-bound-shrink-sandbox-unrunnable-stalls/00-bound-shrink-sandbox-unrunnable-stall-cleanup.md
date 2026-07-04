# Bound shrink sandbox-unrunnable stall cleanup

## Problem

`v1/test/modes/patch/shrink.sandbox-unrunnable.test.ts` can leave CI waiting on
the shrink stall path's real git subprocesses or owned idle-hang fixtures
instead of failing as a test.

## Decisions

- Fix the shrink test path itself — rules out masking the stall with a job-level CI timeout.
- Bound every real git subprocess on the shrink stall path — rules out leaving unrelated calls in this file in scope for this subspec.
- Fail the shrink stall case within 30s, including cleanup — rules out an arbitrarily long "bounded" timeout that still wedges CI in practice.
- Reap every hang fixture child the shrink stall path starts on success and failure — rules out relying on process exit or best-effort `afterEach` cleanup alone.
- Keep sibling `*.sandbox-unrunnable.test.ts` audits out of scope here — rules out widening this subspec into a multi-file hardening pass.
- Record the post-fix operator/workflow behavior in `v2/docs/v1-behaviors.md` and keep any `v1/docs/operator-runbook.md` note pointer-only — rules out duplicating the same behavior contract across durable docs.
- Deferred to first consumer: a shared bounded-subprocess helper for other sandbox-unrunnable suites — pin when a second caller needs the same contract.

## Task checklist

- [ ] Characterize the shrink stall path well enough to identify every real git subprocess and owned idle-hang fixture that can block that path.
- [ ] Harden `v1/test/modes/patch/shrink.sandbox-unrunnable.test.ts` so the shrink stall path fails within 30s and reaps its owned fixtures cleanly.
- [ ] Keep the failure as a red test in this file instead of an indefinitely running CI `Test` step.
- [ ] Update the durable docs listed below in the same change.

## Acceptance criteria

- [ ] A stalled shrink case in `v1/test/modes/patch/shrink.sandbox-unrunnable.test.ts` fails red within 30s instead of hanging the CI `Test` job indefinitely.
- [ ] Every real git subprocess on the shrink stall path runs under the same 30s failure window, so no owned git call on that path can block the file past that bound.
- [ ] Every idle-hang fixture child started by the shrink stall path is reaped when the 30s failure fires, including failure paths that exit before normal test cleanup.
- [ ] The hardened shrink file still exercises the real shrink-path stall behavior rather than replacing it with a workflow-level CI timeout or a fully mocked path.
- [ ] `v2/docs/v1-behaviors.md` records that shrink sandbox-unrunnable stalls now fail red within 30s with cleanup instead of hanging the test job.
- [ ] `v1/docs/operator-runbook.md` points operators at the shrink-specific behavior in `v2/docs/v1-behaviors.md` without restating the same contract.

## Documentation updates

- `v2/docs/v1-behaviors.md` — record the shrink sandbox-unrunnable 30s failure-and-cleanup behavior as the shipped v1 baseline.
- `v1/docs/operator-runbook.md` — add a shrink-specific troubleshooting pointer to `v2/docs/v1-behaviors.md` without duplicating the behavior contract.
