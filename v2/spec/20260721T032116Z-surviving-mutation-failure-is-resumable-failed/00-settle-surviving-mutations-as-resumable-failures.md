# Settle surviving mutations as resumable failures

Mutation verification runs after the implementation attempt has crossed its completion boundary. A surviving guard can therefore leave a `completed` row while later reporting failure, hiding remediation from list/wait and causing resume to refuse the retained worktree. Make finalization's surviving-mutation verdict authoritative across durable state and every operator surface.

## Decisions

- Settle `surviving_mutation_failed` as durable `failed`; rules out retaining the earlier completion boundary's `completed` status.
- Make the failure resumable with `retryable: true` and `nextAction: "resume"`; rules out forcing a fresh branch and losing review history.
- Persist the mutation text and source site with the terminal observation; rules out transient result-only diagnostics that disappear from list/wait.
- Require terminal status and resumability to agree; rules out any persisted `completed` + `resumable: true` combination.
- Preserve mutation verification and its verdict; rules out weakening the gate to restore green completion.

## Tasks

- Make finalization overwrite an earlier completion settlement when a mutation survives, while leaving genuine completion unchanged.
- Carry the surviving guard and source site through the terminal log and shared list/wait operator error.
- Admit failed surviving-mutation rows through the existing workflow resume reconstruction path.
- Add regressions for settlement, operator reporting, resume, and the successful-completion control.
- Align durable completion, daemon, state, recovery, and v1-parity docs.

## Acceptance criteria

- [ ] A run ending `surviving_mutation_failed` settles `failed`; neither `run list` nor `run wait` reports it `completed`.
- [ ] `run list` and `run wait` report `reason: "surviving_mutation_failed"`, `retryable: true`, `nextAction: "resume"`, and the surviving mutation text plus source file and line.
- [ ] The final `loop_finished` record reports the same mutation details and resumability, and `run resume` accepts that failed workflow row.
- [ ] No persisted terminal observation combines `runStatus: "completed"` with `resumable: true`.
- [ ] A regression in `v2/src/execution/workflow-runner.test.ts` drives mutation finalization after the earlier completion boundary, fails against the baseline, and asserts durable `failed` status plus resumable terminal details.
- [ ] Updated daemon cases in `v2/src/daemon/daemon-start-list.test.ts`, `v2/src/daemon/daemon-wait-run-completion.test.ts`, `v2/src/daemon/run-operator-error.test.ts`, and `v2/src/daemon/daemon-resume.test.ts` pin consistent list, wait, error, and resume behavior.
- [ ] A genuine completion remains `completed`, non-resumable, and free of surviving-mutation remediation.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/docs/operator-runbook.md`, `v2/docs/state-store.md`, `v2/docs/workflow-runner.md`, `v2/docs/write-behavior.md`, `v2/docs/daemon-host.md`, and `v2/docs/v1-behaviors.md` describe the failed/resumable settlement, terminal invariant, diagnostics, and recovery.

## Documentation updates

- `v2/docs/operator-runbook.md` — completed-run trust and coverage-before-resume recovery.
- `v2/docs/state-store.md` — terminal status/resumability invariant.
- `v2/docs/workflow-runner.md` — mutation-finalization settlement and resume behavior.
- `v2/docs/write-behavior.md` — direct completion failure and remediation semantics.
- `v2/docs/daemon-host.md` — list/wait fields and resume eligibility.
- `v2/docs/v1-behaviors.md` — changed v2 failure-reporting semantics.
