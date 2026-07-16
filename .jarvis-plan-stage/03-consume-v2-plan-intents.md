# Consume v2 Plan Intents

## Scope

Consume every ready-intent read by v2 plan workflows after the durable spec tree contains its `intent.md` copy.

## Decisions

- Reuse v2 intent publication ownership and consumption, not plan-specific cleanup; rules out lifecycle drift between promotion hops.
- Put git-backed deletion in the plan completion commit after spec-tree landing; rules out a separate deletion commit.
- Delete non-git ready-intents only after the whole spec tree lands; rules out early consumption on draft, review, collision, or partial landing failure.
- Preserve the complete recorded origin collection through resume; rules out consuming only the first input in future batched plan promotion.
- Preserve external-spec cleanup unchanged; rules out coupling promotion with archival.

## Work

- Record ready-intent ownership in v2 plan builders and feed it through the existing publication consumption boundary.
- Cover draft-only and reviewed plan variants, git and non-git publication, retry, and unsafe targets.
- Align the v2 workflow and operator durable docs with the ready-intent queue lifecycle.

## Acceptance criteria

- [ ] Successful v2 plan publication consumes every ready-intent read after its content is copied into the durable spec tree as `intent.md`.
- [ ] Git-backed deletion is included in the plan completion commit; failed landing or publication leaves the source queue intact and retryable.
- [ ] Non-git draft, review, collision, validation, partial landing, or filesystem failure preserves every ready-intent.
- [ ] Missing, external, and symlink-escaped mapped targets remain undeleted.
- [ ] Workflow snapshot/resume retains every recorded ready-intent origin rather than only the first.
- [ ] `v2/src/execution/publication-workflow-steps.test.ts`, `v2/src/execution/publication-landing.test.ts`, and `v2/src/execution/workflow-runner.test.ts` add pre-fix-failing plan coverage for git, non-git, failure, all-recorded-input, unsafe-target, and resume cases.
- [ ] `v2/docs/write-behavior.md`, `v2/docs/first-workflow-walkthrough.md`, and `v2/docs/operator-runbook.md` document ready-intents as open work, cross-linking the authoritative consumption and retry contract.
- [ ] External-spec cleanup behavior remains covered and unchanged.
