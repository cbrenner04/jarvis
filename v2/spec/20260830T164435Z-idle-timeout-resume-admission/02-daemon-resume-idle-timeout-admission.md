# Daemon resume idle-timeout admission

## Problem

`jarvis run resume` refuses failed write rows whose terminal `loop_finished` records `idle_output_timeout` even when `resumable: true`, because `isResumeAdmitted` follows `composeRunOperatorError` and the baseline maps every idle timeout to `nextAction: "stop"`. Operators must salvage committed checkpoint work by hand or re-dispatch and lose the retained branch/worktree continuity.

## Prerequisites

- [00 - Operator-error idle-timeout projection](./00-operator-error-idle-timeout-projection.md) merged — resumable `idle_output_timeout` composes to `nextAction: "resume"`.
- [01 - Daemon list/wait idle-timeout projection](./01-daemon-list-wait-idle-timeout-projection.md) merged — list/wait agree with the composer on resumable idle timeouts.

## Decision ledger

- Subspec 02 is the **end-to-end verification slice** for `isResumeAdmitted` and retained-workspace resume — admission already follows `composeRunOperatorError` once subspec 00 lands; the git-backed test is the novel failing-test surface.
- Admit `jarvis run resume` when `composeRunOperatorError` reports `nextAction: "resume"` for a failed `idle_output_timeout` with terminal `loop_finished.resumable: true` — rules out advertising recovery the daemon refuses.
- Refuse resume for `resumable: false`, missing terminal proof, or attempt-only idle timeouts — rules out inferring checkpoint progress at admission time.
- Resume re-enters the persisted write step on the retained branch and worktree without stale reset and the resumed run reaches durable completion — rules out fresh dispatch or worktree discard that loses the checkpoint commit; mirror `resume after iteration_timeout retains worktree commits without stale reset`.
- Extend `WRITE_LOOP_OUTCOME_KINDS` / `RESUMABLE_AGREEMENT_CASES` (and the mirrored outcome-kind list) to include `idle_output_timeout` — rules out list/wait/resume agreement drift for this reason.
- Synthetic `resume admits` `test.each` row and no-progress refusal fixture are regression guards only, not the subspec failing-test AC.

## Tasks

- Add `daemon-resume.test.ts` git-backed integration: silent stall with committed progress, failed terminal row, admitted resume, second iteration completes on same branch/worktree with checkpoint commit retained.
- Add refusal fixture for no-progress `idle_output_timeout` (`resumable: false`) — regression guard.
- Extend `WRITE_LOOP_OUTCOME_KINDS` and `RESUMABLE_AGREEMENT_CASES` for `idle_output_timeout`; extend `resume admits` `test.each` row — regression guards.
- Update operator runbook recovery guidance (committed-progress `jarvis run resume` vs no-checkpoint re-dispatch); finalize `v1-behaviors.md` resume-admission parity.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-resume.test.ts` drives a git-backed write step to failed `idle_output_timeout` with terminal `loop_finished.resumable: true` and a fresh `iteration_commit`, admits `jarvis run resume`, the resumed iteration reuses the retained branch and worktree, retains the checkpoint commit without stale reset, and the run reaches durable completion (`complete` / `done` or equivalent); fails against the baseline `terminal_run` refusal reachable when `isResumeAdmitted` follows the unconditional stop mapping.
- [ ] `daemon-resume.test.ts` `wait and list resumable agrees with resume admission (idle_output_timeout on failed)` stays green after `idle_output_timeout` is added to `WRITE_LOOP_OUTCOME_KINDS` / `RESUMABLE_AGREEMENT_CASES`; regression guard for list/wait/resume agreement.
- [ ] `daemon-resume.test.ts` refuses `jarvis run resume` for a no-progress `idle_output_timeout` (`resumable: false`); regression guard — stays green and would fail if admission ignored `resumable`.
- [ ] `v2/docs/operator-runbook.md` **Idle-output stalls** section documents committed-progress write-path `idle_output_timeout` recovery via `jarvis run resume` when `nextAction: "resume"`, and retains stop/re-dispatch guidance when no checkpoint commit exists.
- [ ] `v2/docs/operator-runbook.md` **Gotchas** `idle_output_timeout` false-kills entry replaces hand-salvage-only guidance with `jarvis run resume` when the terminal row is resumable; retains re-dispatch / salvage when no checkpoint commit exists.
- [ ] `v2/docs/v1-behaviors.md` records daemon resume admission and retained-workspace resume semantics for committed-progress `idle_output_timeout`.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/operator-runbook.md` — committed-progress idle-timeout resume vs re-dispatch when no checkpoint commit.
- `v2/docs/v1-behaviors.md` — daemon resume admission and retained-workspace semantics for `idle_output_timeout`.
