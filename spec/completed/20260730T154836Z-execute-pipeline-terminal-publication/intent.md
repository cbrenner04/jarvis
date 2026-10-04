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
- Not invoked by production until settle lands; full `leave-draft` semantics require settle to wire completion + terminal publication serially.
- Completion ready-finalization coordination is out of scope — settle/upstream must skip completion ready flip when `terminalAction` is `leave-draft`.
- Leave-draft performs no PR-state mutation; rules out an implicit ready flip.
- Ready runs the ready gate before the ready flip; merge runs the same gate and ready transition before merge; rules out a second merge-only gate path.
- Ready and merge fail fast without PR evidence; leave-draft may succeed with optional passthrough evidence.
- A red gate prevents every later ready-flip or merge mutation; rules out merging or flipping a PR that failed readiness checks.
- An action error names the action and wraps a normalized publication failure; PR evidence is retained and no close or delete runs; rules out cleanup that destroys recovery evidence.
- Deferred to first consumer: merge command flags, retry, and already-completed idempotency details — pin when the terminal publication adapter is implemented.

## Acceptance criteria

- [ ] `terminal-publication.test.ts` — `executes each terminal action type once against fake publication` fails against the baseline, then drives leave-draft, ready, and merge in separate cases (three invocations, not one pipeline running all three).
- [ ] `terminal-publication.test.ts` — `does not ready-flip or merge after a red ready gate` fails against the baseline, then confirms zero ready-flip and zero merge calls and turns RED when the gate guard is inverted.
- [ ] `terminal-publication.test.ts` — `retains PR evidence on ready gate failure` fails against the baseline, then reports the requested action and wrapped gate failure without closing or deleting the PR.
- [ ] `terminal-publication.test.ts` — `retains PR evidence on terminal mutation failure` fails against the baseline, then reports the requested action and wrapped flip or merge failure without closing or deleting the PR.
- [ ] `terminal-publication.test.ts` — `fails fast for ready and merge without PR evidence` fails against the baseline, then confirms zero `gh` calls when `prNumber`/`prUrl` are absent.
- [ ] Inverting the leave-draft no-mutation, red-gate-before-flip-or-merge, or failure-preservation guard makes `terminal-publication.test.ts` fail; negative cases use injectable close/delete seams or a shared `gh` call log to prove spurious `gh` calls, merge or flip after a red gate, and PR close or delete on gate or mutation failure.

## Documentation updates

- `v2/docs/workflow-runner.md` — draft publication, completion/terminal composition, terminal action ordering, shared ready gate, and failure preservation.
- `v2/docs/v1-behaviors.md` — v2 terminal-publication behavior.
