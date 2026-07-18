# 03 - Consume v2 plan ready-intents

V2 plan landing copies a ready-intent into the durable spec as `intent.md` but
leaves the source in the open-work queue.

## Decisions

- Record every ready-intent read by the plan builder in the existing publication-input metadata; rules out deleting only a reconstructed or first input in batched promotion.
- Consume ready-intents through the same landing boundary as v2 intent seeds; rules out a second path-safety and retry policy for plan promotion.
- In Git mode, map deletion into the plan worktree before completion commit; rules out mutating the registered checkout or splitting input consumption from the spec artifact commit.
- In no-Git mode, consume ready-intents only after the complete spec tree and byte-identical `intent.md` copy land; rules out losing input on draft, review, validation, collision, or filesystem failure.
- Leave external-spec archival cleanup unchanged as an idempotent fallback; rules out widening promotion into archive-time behavior.

## Acceptance criteria

- [x] `v2/src/execution/plan-workflow-steps.test.ts` and `v2/src/execution/workflow-runner.test.ts` add a regression that fails against the baseline and proves `intent.md` is a byte-identical ready-intent copy and the Git-backed completion commit also deletes every ready-intent input actually read.
- [x] `v2/src/execution/workflow-runner.test.ts` proves no-Git ready-intents are consumed only after the complete spec tree lands, while draft, review, validation, collision, and filesystem-publication failures retain them.
- [x] `v2/src/execution/publication-landing.test.ts` proves missing, external, and symlink-escaped plan inputs are skipped and publication resume is idempotent.
- [x] `v2/src/execution/plan-workflow-steps.test.ts`, `v2/src/execution/publication-landing.test.ts`, and `v2/src/execution/workflow-runner.test.ts` existing plan builder, landing, review, completion-publication, and external-output tests stay green.

## Documentation updates

- `v2/docs/workflow-runner.md` — add plan ready-intent consumption to the shared publication contract.
- `v2/docs/first-workflow-walkthrough.md` — document plan success/failure consumption semantics.
- `v2/docs/operator-runbook.md` — identify `seeds/` and `ready-intents/` as open-work queues and cross-link the workflow publication contract.
