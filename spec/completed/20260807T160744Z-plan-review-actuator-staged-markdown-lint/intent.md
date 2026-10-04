---
name: plan-review-actuator-staged-markdown-lint
---

# Plan and intent review actuator re-lints staged Markdown before completion

The fix touches one module-boundary surface (execution loop), so splitting does not apply: plan and intent review actuator paths share the same post-actuator completion seam in the workflow runner.

## Problem

Plan/intent write steps lint staged Markdown before finalization (shipped `plan-intent-write-steps-lint`), but the review actuator runs afterward and edits staged spec files without re-linting. An actuator-introduced Markdown-lint violation slips past the write-step gate and fails later at CI `lint:md` and/or the completion gate after the draft is committed, stranding finalization (observed 2026-08-07: plan debate actuator `MD038` from nested backticks around `` `(project, branch)` ``).

## Decisions

- Plan and intent review actuator paths re-run staged Markdown lint after applying edits and before completion commit/landing — rules out actuator-introduced violations reaching CI or the completion gate.
- Reuse `lintStagedMarkdown` and the write-step staged-path lint contract — rules out a new linter or full-corpus `lint:md` during review.
- On lint failure, bounded actuator reprompt reuses `write.staged-markdown-lint-reprompt` and `staged_markdown_lint_reprompt` with the same rule-id/file-path payload as the write loop — rules out a divergent reprompt surface and rules out hard strand on a fixable authoring slip without retry.
- Deferred to first consumer: review-step retry budget and whether lint reprompt consumes `maxCycles` or a separate bounded counter — pin when wiring the review loop.

## Acceptance criteria

- [ ] `workflow-runner.test.ts` `review actuator staged Markdown lint violation blocks completion before landing` drives a reviewed plan or intent workflow whose actuator introduces a staged `MD012`/`MD038` violation, asserts completion commit/landing does not run while the violation remains, and fails against pre-fix code that lints only the pre-actuator draft.
- [ ] `workflow-runner.test.ts` `review actuator staged Markdown lint violation reprompts before completion` drives the same violation fixture, asserts a `staged_markdown_lint_reprompt` carrying rule id and file path, asserts the review loop retries the actuator without terminal settlement on the first miss, and fails against pre-fix code that blocks without reprompt.
- [ ] Mutation checkpoint: in `workflow-runner.test.ts`, the test titled `review actuator staged Markdown lint violation blocks completion before landing` carries a `// @mutate` directive (inside the test body) on the post-actuator staged-Markdown lint guard line in `workflow-runner.ts`; the mutation turns that test RED.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — plan/intent review re-lints staged Markdown after the actuator and before completion landing; reprompt semantics.
- `v2/docs/write-behavior.md` — post-actuator staged-Markdown lint on the review completion seam.
- `v2/docs/v1-behaviors.md` — record the post-actuator staged-Markdown lint gate for plan/intent review.

## Prerequisites

- Plan and intent write steps run `lintStagedMarkdown` on staged Markdown before finalization.
- `lintStagedMarkdown` runs `markdownlint-cli2` on staged `*.md` paths with the same `.markdownlint-cli2.jsonc` rules as `bun run lint:md`.
- `write.staged-markdown-lint-reprompt` and `staged_markdown_lint_reprompt` exist for write-step staged-Markdown lint reprompts.
- `landReviewedPublicationOutput` is the shared post-actuator completion seam for bare `plan` / `intent` with review and compatibility aliases (`plan-reviewed-light`, `plan-reviewed`, `intent-reviewed`); the review actuator may edit staged Markdown after the write-step lint gate and before that landing runs.
