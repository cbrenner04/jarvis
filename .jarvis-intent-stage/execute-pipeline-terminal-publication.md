---
name: execute-pipeline-terminal-publication
---

# Execute terminal publication actions behind one guarded surface

## Prerequisites

- Approval stages durably block progression; approve advances, reject terminates, and resume does not redispatch completed prior stages.
- Project pipeline resolution carries one validated leave-draft, ready, or merge action and rejects approval-policy conflicts before admission.

## Problem

Publication can create and ready a PR, but no single execution surface can intentionally leave it draft or merge it while preserving ready-gate ordering.

## Decisions

- One terminal publication surface consumes the validated action plus existing PR and worktree evidence; rules out daemon code issuing publication commands directly.
- Leave-draft performs no PR-state mutation; rules out an implicit ready flip.
- Ready runs the ready gate before the ready flip; merge runs the same gate and ready transition before merge; rules out a second merge-only gate path.
- A red gate prevents every later ready or merge mutation; rules out merging a PR that failed readiness checks.
- An action error names the action and underlying publication error and does not delete or close the PR; rules out cleanup that destroys recovery evidence.
- Deferred to first consumer: merge command, retry, and already-completed idempotency details — pin when the terminal publication adapter is implemented.

## Acceptance criteria

- [ ] Focused fake-publication tests exercise leave-draft, ready, and merge once each and assert their ordered calls.
- [ ] A red ready gate causes zero merge calls, and inverting that guard turns the test RED.
- [ ] Each mutation failure retains the PR and reports both the requested action and underlying error.

## Documentation updates

- `v2/docs/workflow-runner.md` — draft publication, terminal action ordering, shared ready gate, and failure preservation.
