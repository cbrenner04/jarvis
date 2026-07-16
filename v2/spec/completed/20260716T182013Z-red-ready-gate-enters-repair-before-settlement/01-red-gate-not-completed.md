# 01 - A red ready gate cannot settle as completed

## Problem

The write loop commits its `completed` boundary before publication runs, and the
workflow-runner completion block never demotes it. A run whose ready gate stays
red therefore persists `runStatus: "completed"` in the state store and reports
completed in `run list`, with the red gate visible only as a terminal-log
`loopOutcomeKind`. The operator discovers the red branch later.

## Decisions

- Demote the run to `failed` when a red ready gate settles terminally, matching the pre-publication landing failure precedent (`workflow-runner.ts` `store.setRunStatus(runId, "failed")`); rules out inventing a new run status for one publication outcome.
- Keep publication-retry resume working for the demoted status: `isPublicationRetryEligible` gating currently requires `run.status === "completed"` (`daemon.ts:307`, `daemon.ts:1004`), which the demotion breaks; rules out silently converting a resumable gate failure into an unresumable dead end.
- Leave `completion_commit_failed` settlement untouched; rules out widening this to every publication failure when only the gate defines completion.

## Task checklist

- [ ] Demote the run status on terminal `ready_gate_failed` in the workflow-runner completion block.
- [ ] Update the daemon's publication-retry eligibility so a `failed` + `ready_gate_failed` run stays resumable in `resumeContextForRun` and `terminalResumeBlocked`.
- [ ] Add regression coverage for the settled status, the `run list` row, and resume eligibility.

## Acceptance criteria

- [x] A new workflow-runner test asserts that after repair is exhausted against a persistently red gate, the run's persisted status is `failed`, not `completed`; it fails against the pre-fix code, which persists `completed`.
- [x] A new daemon test asserts `run list` shows the red-gate run as not completed and carries the `ready_gate_failed` reason with `nextAction: "resume"`.
- [x] `run resume` on a red-gate run is still accepted and retries publication; it is not rejected as `terminal_run`.
- [x] A workflow whose gate is green (or goes green via repair) still settles `completed` — `workflow-runner.test.ts` completion tests stay green.
- [x] A `ready_flip_failed` run's settled status is unchanged by this subspec — `write-loop.test.ts` and `workflow-runner.test.ts` flip-failure tests stay green.

## Documentation updates

- `v2/docs/write-behavior.md` — `completed` requires a green ready gate; a red gate settles `failed` and stays publication-retry resumable.
- `v2/docs/operator-runbook.md` — gate trust: a completed run means a green gate; remove guidance telling operators to check for a red gate behind a completed run.
- `v2/docs/v1-behaviors.md` — record the changed v2 completion guarantee.
