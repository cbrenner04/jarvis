---
name: accept-nested-plan-draft-stage-layout
---

# Accept Nested Plan-Draft Stage Layout

Unsplit rationale: Layout resolution, shape validation, normalization, and regression coverage stay within the execution-loop plan-draft completion boundary; persistence, daemon, and CLI contracts do not change.

## Primary implementation surface

- Execution-loop plan-draft validation and normalization in `v2/src/execution/write.ts`

## Prerequisites

## Problem

- The injected spec guidance demonstrates `spec/<name>/index.md`, but plan-draft completion only accepts `index.md` and numbered subspecs directly under `.jarvis-plan-stage/`, so a well-formed nested draft settles `contract_miss` with `plan.draft.shape`.

## Decisions

- Accept either the existing flat stage tree or exactly one `.jarvis-plan-stage/spec/<name>/` spec tree, then flatten the accepted nested tree before downstream normalization; rules out prompt-only enforcement that remains vulnerable to the injected durable-layout examples.
- Promote accepted nested drafts to the same durable layout as flat drafts; rules out two on-main artifact contracts.
- Reject nested `spec/` containers with zero or multiple candidate spec directories; rules out ambiguous directory selection.

## Acceptance criteria

- [ ] `v2/src/execution/write.test.ts` drives plan-draft completion with `.jarvis-plan-stage/spec/<name>/{index.md,00-*.md}`, proves validation passes and the staging tree is flat before existing module-boundary normalization and landing continue, and fails against the pre-fix top-level-only validator.
- [ ] `v2/src/execution/write.test.ts` proves the existing flat `.jarvis-plan-stage/{index.md,00-*.md}` form still completes and lands identically.
- [ ] `v2/src/execution/write.test.ts` rejects nested `spec/` containers with zero or multiple candidate spec directories as `plan.draft.shape`; the enclosing test body includes `// @mutate invert exactly-one nested-spec-directory guard`, which turns RED when the real selection guard is inverted.
- [ ] `v2/docs/write-behavior.md`, `v2/docs/v1-behaviors.md`, and the injected `v1/docs/spec-guidance.md` state that staging accepts flat or single-nested input and lands one identical durable spec layout.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- Update `v2/docs/write-behavior.md` as the authoritative v2 workflow contract, align the existing-functionality catalog in `v2/docs/v1-behaviors.md`, and clarify the staging form in injected `v1/docs/spec-guidance.md` without changing durable spec layout guidance.
