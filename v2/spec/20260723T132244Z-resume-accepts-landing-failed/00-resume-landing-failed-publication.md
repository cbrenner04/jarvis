# Resume landing-failed publication

A run settled `failed` / `landing_failed` reports `retryable: true` and
`nextAction: "resume"` on `run list` / `run wait`, but `jarvis run resume`
refuses `terminal_run: Cannot resume a failed run` even though the write step
is committed and only publication failed.

## Decisions

- Admit `landing_failed` failed rows through the same shared resume-eligibility helper `list`, `wait`, and `resume` use; rules out a `run resume` one-off that leaves row advertisements unreachable.
- Resume replays publication from the persisted write snapshot; rules out re-invoking the write-step agent.
- Keep `ready_flip_failed`, unretryable `completed`, and `blocked` resume refusals unchanged; rules out making every `failed` row resumable.
- Scope list/wait operator-error composition to admission only — `composeRunOperatorError` already advertises `landing_failed` correctly; rules out reworking row projection in this slice.

## Tasks

- Extend shared daemon resume eligibility and `terminalResumeBlocked` admission for `landing_failed` failed rows.
- Respawn publication retry through existing snapshot reconstruction; preserve checkpoint skip so landing resumes without write-step agent invocation.
- Add daemon and workflow regressions for admission, guard inversion, and failing-then-succeeding publication via resume.
- Align operator-runbook recovery copy and v1-parity baseline.

## Acceptance criteria

- [x] A `failed` row with `error.reason: "landing_failed"`, `retryable: true`, and `nextAction: "resume"` is accepted by `jarvis run resume` and respawns from its persisted write snapshot.
- [x] `v2/src/daemon/daemon-resume.test.ts` has a regression that fails against the baseline with `terminal_run` and passes once `landing_failed` admission is wired; inverting the admission guard restores the refusal.
- [x] `v2/src/execution/workflow-runner.test.ts` has a regression that drives landing failure then daemon resume through succeeding publication, asserts publication completes without a new write-step agent invocation, and fails against the baseline `terminal_run` refusal.
- [x] `daemon-resume.test.ts` flip/settlement refusal cases stay green.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Publication / completion failures — include `landing_failed` among resumable publication failures; drop any implication that abandon-and-re-run is the recovery.
- `v2/docs/v1-behaviors.md` — `landing_failed` failed rows are resumable via `jarvis run resume`.
