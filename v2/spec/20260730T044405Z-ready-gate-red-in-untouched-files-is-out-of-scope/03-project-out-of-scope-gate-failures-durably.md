# Project out-of-scope gate failures durably

## Problem

An out-of-scope settlement must retain its evidence through workflow persistence and every
operator-facing status surface.

## Decision ledger

- Persist `ready_gate_out_of_scope`, its normalized outside paths, and detail stating they lie
  outside the run's touched set through finalization, workflow settlement, durable logs, parsing,
  and reconstruction.
- `list` and `wait` expose that named reason, paths, and retry-finalization recovery guidance; they
  do not tell the operator to repair source files.
- Include the new failed/resumable reason in every affected outcome mirror, recovery set, and CLI
  exit projection, while preserving existing reasons' behavior.

## Task checklist

- Thread the reason and evidence through publication/workflow settlement and durable records.
- Project the durable evidence through daemon list/wait and CLI outcome handling.

## Acceptance criteria

- [ ] `v2/src/execution/workflow-runner.test.ts` adds a pre-fix-failing workflow regression that
      settles an attributed untouched red gate as failed and resumable, emits no `ready_gate_repair`,
      performs no repair-agent invocation, and retains detail that named paths are outside the
      touched set; one in-scope failing path retains today's bounded `ready_gate_failed` repair
      behavior.
- [ ] Durable persistence/parsing and workflow-settlement tests prove the reason and named outside
      paths survive reconstruction and the affected CLI exit/status mirrors expose the failed,
      resumable outcome; inverting either field propagation turns its test RED.
- [ ] `v2/src/daemon/run-operator-error.test.ts` proves `list`/`wait` projection names
      `ready_gate_out_of_scope`, preserves the outside paths, and gives retry-finalization recovery
      rather than repair guidance.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — untouched-path red is out of scope, retry
  finalization, and review every repair commit's file list before merging.
- `v2/docs/daemon-host.md` — durable failed/resumable reason and list/wait evidence.
- `v2/docs/workflow-runner.md` — settlement, persistence, recovery, and CLI outcome semantics.
- `v2/docs/v1-behaviors.md` — v2 parity delta for untouched-path ready-gate classification.
