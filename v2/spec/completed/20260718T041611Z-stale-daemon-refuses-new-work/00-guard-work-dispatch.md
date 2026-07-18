# Guard work dispatch by daemon revision

## Problem

A daemon keeps its startup source snapshot after the invoking checkout changes. New or resumed work can therefore run under code different from the CLI that dispatched it.

## Decisions

- Compare revisions in every CLI and TUI client path immediately before `start` or `resume`; rules out relying on stale daemon code to reject itself.
- Refuse mismatches before sending the work request and name loaded/current revisions with restart guidance; rules out warning-only dispatch.
- Apply the guard to fresh writes, workflow starts, ordinary resumes, and human-decision resumes; rules out stale-code entry through a second admission path.
- Exempt health, status, list, log/tail, wait, pause, kill, daemon start, and daemon stop; rules out blocking diagnosis, observation, steering, or recovery.
- Do not reload, stop, or alter admitted runs; rules out client-side intervention in in-flight work.

## Work

- Add a shared client-dispatch revision preflight using the daemon's loaded revision and the invoking source revision.
- Wire all current CLI and TUI `start` and `resume` dispatches through it.
- Add mismatch, match, and exempt-command regression coverage.
- Update `v2/docs/write-behavior.md` with the guarded requests and error contract.
- Update `v2/docs/operator-runbook.md` to replace the restart-after-every-merge stopgap with mismatch recovery that preserves active work.
- Update `v2/docs/v1-behaviors.md` with the v2-only guard.

## Acceptance criteria

- [x] When loaded and invoking revisions differ, fresh write and workflow dispatches exit nonzero, send no `start` request, and report both revisions plus daemon restart guidance.
- [x] When loaded and invoking revisions differ, ordinary and human-decision resumes exit nonzero, send no `resume` request, and report both revisions plus daemon restart guidance.
- [x] Matching revisions preserve existing start and resume outputs, daemon requests, and run behavior.
- [x] Observation, steering, and lifecycle commands remain available across a revision mismatch, and already admitted or in-flight runs are not mutated by the preflight.
- [x] New cases in `v2/src/cli.test.ts` and `v2/src/tui/tui-daemon-client.test.ts` fail against the pre-fix code and pass with guarded start/resume dispatch.
- [x] `v2/docs/write-behavior.md`, `v2/docs/operator-runbook.md`, and `v2/docs/v1-behaviors.md` document the shipped behavior without retaining the restart-after-every-merge stopgap.
