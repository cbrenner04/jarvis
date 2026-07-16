---
name: publication-failure-cause-is-in-the-run-log
---

# Publication failure cause is in the run log

A run can finish every agent invocation successfully, fail during publication or ready
finalization, and leave only a generic terminal outcome in its durable log. The operator cannot
recover which harness step or command failed.

## Behavior

- A terminal publication or ready-finalization failure records the failed publication step and its concrete underlying error in the run log.
- Standalone and workflow publication failures expose the same durable diagnostic evidence.
- Operator recovery uses the run log as the authoritative publication-failure record.

## Decisions

- Persist publication failure evidence with the terminal run event — rules out relying on ephemeral daemon stderr.
- Name the harness publication boundary separately from agent invocation outcomes — rules out diagnosing successful agent work as `invocation_failure` without its later cause.
- Preserve the underlying command error — rules out logging only a generic publication outcome or guessed cause.

## Out of scope

- Publication retry classification and notices.
- Workflow process exit codes.
- Review-step log emission.

## Documentation updates

- `v2/docs/operator-runbook.md` — recover publication failures from the run log, not `~/.jarvis/daemon.log`.
- `v2/docs/write-behavior.md` — durable publication-failure event semantics.
- `v2/docs/v1-behaviors.md` — record the changed failure-reporting behavior.

## Prerequisites
