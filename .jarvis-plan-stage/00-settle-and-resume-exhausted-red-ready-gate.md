# Settle and resume an exhausted red ready gate

## Problem

An implement run whose bounded ready-gate repairs all remain red can leave a completed durable row over a draft PR. The row then contradicts the gate evidence and cannot recover through a gate-only resume.

## Decisions

- Settle exhausted-red finalization as `failed` / `ready_gate_failed` with `resumable: true` — rules out `completed` over a red gate.
- Preserve checked acceptance criteria — rules out treating gate failure as unfinished spec work.
- Keep the PR draft when repair exhausts — rules out a draft-to-ready flip after failed verification.
- Project `nextAction: "resume"` consistently through list, wait, error composition, and admission — rules out surface-specific recovery answers.
- Resume only finalization and rerun the ready gate without agent/write-loop entry — rules out replaying completed implementation work.
- Preserve completion when a repair makes the gate green — rules out converting successful repair into failure.

## Work

- Pin exhausted-red settlement on the owning durable row, including terminal gate evidence, resumability, checked criteria, and absence of the ready flip.
- Route admitted `ready_gate_failed` resume through the retained finalization context and shared publication/gate tail without spawning the write loop.
- Align list, wait, `composeRunOperatorError`, and resume admission with the durable failed-row contract.
- Update the durable operator and behavior docs in this subspec.

## Acceptance criteria

- [ ] `v2/src/execution/workflow-runner.test.ts` `caps ready gate repairs and settles as ready_gate_failed when exhausted` drives every repair gate red and asserts the owning durable row is `failed`, its terminal error reason is `ready_gate_failed`, it is resumable, its criteria remain checked, and the draft-to-ready flip is not called.
- [ ] `v2/src/daemon/daemon-resume.test.ts` covers the exhausted `ready_gate_failed` row through `run list`, `run wait`, and `run resume`: all advertise `runStatus: "failed"`, `resumable: true`, and `nextAction: "resume"`, while resume reruns finalization without spawning the write loop; this test fails against the pre-fix write-loop resume path.
- [ ] `v2/src/daemon/run-operator-error.test.ts` keeps `composeRunOperatorError` aligned on `ready_gate_failed` / `resume` / retryable for the failed durable row.
- [ ] `v2/src/execution/write-loop.test.ts` `repairs a red ready gate through a write iteration` and `v2/src/execution/workflow-runner.test.ts` `routes a red ready gate through bounded repair before settlement` stay green.
- [ ] Inverting the exhausted-red settlement or finalization-only resume guards makes the named workflow-runner or daemon-resume regressions fail; the exhausted case's flip assertion fails if the suppressed flip occurs.
- [ ] `v2/docs/operator-runbook.md` § Gate trust states that repair-budget exhaustion settles `failed` / `ready_gate_failed`, remains resumable, and does not weaken the guarantee that `completed` implies a green gate.
- [ ] `v2/docs/write-behavior.md` documents failed exhausted-red settlement and finalization-only resume.
- [ ] `v2/docs/v1-behaviors.md` records the same operator-visible v2 semantics.

## Documentation updates

- `v2/docs/operator-runbook.md` — exhausted-red gate trust and recovery.
- `v2/docs/write-behavior.md` — settlement and resume behavior.
- `v2/docs/v1-behaviors.md` — v2 parity baseline.
