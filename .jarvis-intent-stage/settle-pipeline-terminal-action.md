---
name: settle-pipeline-terminal-action
---

# Settle daemon-owned pipelines from the terminal action

## Prerequisites

- Approval stages durably block progression; approve advances, reject terminates, and resume does not redispatch completed prior stages.
- Project pipeline resolution carries one validated leave-draft, ready, or merge action and rejects approval-policy conflicts before admission.
- Terminal publication executes leave-draft, ready, and merge with gate-before-mutation ordering and preserves the PR on failure.

## Problem

The daemon currently reports pipeline success when authored stages succeed. It neither runs the configured terminal action nor records its outcome.

## Decisions

- The daemon invokes the terminal publication surface only after every workflow and required approval stage succeeds; rules out early or approval-bypassing finalization.
- Pipeline success requires terminal-action success; rules out reporting completion over a failed ready flip or merge.
- Terminal-action failure settles the pipeline `failed` with the action and underlying error retained durably while leaving the PR intact; rules out hiding finalization failure in logs alone.
- The terminal action targets the final successful workflow stage's recorded PR evidence; rules out rediscovering a different PR from mutable branch state.
- Deferred to first consumer: retry and resume semantics after terminal-action failure — pin when pipeline resume consumes this failure class.

## Acceptance criteria

- [ ] Daemon-level tests drive leave-draft, ready, and merge pipelines end to end against a fake terminal publication surface; one test per action.
- [ ] A terminal-action error settles `failed`, names the action and error, preserves the PR, and never reports the pipeline complete; inverting the settlement guard turns the test RED.
- [ ] A merge pipeline over a red ready gate records failure and performs no merge.

## Documentation updates

- `v2/docs/daemon-host.md` — terminal-action invocation and settlement in the daemon-owned pipeline state machine.
- `v2/docs/workflow-runner.md` — terminal action after final workflow publication and required approval.
