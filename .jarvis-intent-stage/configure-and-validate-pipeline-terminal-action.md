---
name: configure-and-validate-pipeline-terminal-action
---

# Validate the configured pipeline terminal action before admission

## Prerequisites

- Approval stages durably block progression; approve advances, reject terminates, and resume does not redispatch completed prior stages.

## Problem

Project pipeline config selects stages and review posture but cannot state how the final PR should be left. An invalid or approval-incompatible choice can therefore survive admission.

## Decisions

- Project pipeline config must select exactly one of leave-draft, ready, or merge; rules out inferring the action from review posture.
- Resolution composes the selected action into the immutable admitted pipeline definition; rules out rereading mutable project config at completion.
- Action and approval-policy conflicts fail during project-pipeline resolution with the conflicting fields named; rules out late rejection after stage execution.
- Deferred to first consumer: serialized action spellings and the config shape that marks merge as approval-required — pin when project-pipeline admission parses them.

## Acceptance criteria

- [ ] Project-pipeline resolution accepts each terminal action and carries it in the independently owned admitted definition.
- [ ] Unknown action values and approval-incompatible combinations return named pre-admission errors before any pipeline row, worktree, or agent invocation exists.
- [ ] A regression fails when the conflict guard is inverted.

## Documentation updates

- `v2/docs/install-and-config.md` — terminal action values, validation, conflicts, and project example.
- `v2/docs/workflow-runner.md` — the terminal action in the immutable pipeline definition and pre-admission validation boundary.
