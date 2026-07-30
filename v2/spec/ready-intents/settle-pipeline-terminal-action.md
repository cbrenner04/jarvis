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

- [ ] `pipeline-execution.test.ts` — `settles each configured terminal action end to end` fails against the baseline, then drives leave-draft, ready, and merge pipelines once each against fake terminal publication.
- [ ] `pipeline-execution.test.ts` — `fails a pipeline when its terminal action fails` fails against the baseline, then retains the action, error, and PR evidence without reporting completion; its settlement guard inversion turns RED.
- [ ] `pipeline-execution.test.ts` — `does not merge a pipeline after a red ready gate` fails against the baseline, then records failure with zero merge calls.

## Documentation updates

- `v2/docs/daemon-host.md` — terminal-action invocation and settlement in the daemon-owned pipeline state machine.
- `v2/docs/workflow-runner.md` — terminal action after final workflow publication and required approval.
- `v2/docs/v1-behaviors.md` — v2 daemon pipeline terminal-action settlement.
