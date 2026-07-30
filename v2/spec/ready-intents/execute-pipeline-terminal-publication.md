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

- [ ] `terminal-publication.test.ts` — `executes each configured terminal action in order` fails against the baseline, then drives leave-draft, ready, and merge once each against fake publication.
- [ ] `terminal-publication.test.ts` — `does not merge after a red ready gate` fails against the baseline, then confirms zero merge calls and turns RED when the gate guard is inverted.
- [ ] `terminal-publication.test.ts` — `retains PR evidence on terminal mutation failure` fails against the baseline, then reports the requested action and underlying error without closing or deleting the PR.

## Documentation updates

- `v2/docs/workflow-runner.md` — draft publication, terminal action ordering, shared ready gate, and failure preservation.
- `v2/docs/v1-behaviors.md` — v2 terminal-publication behavior.
