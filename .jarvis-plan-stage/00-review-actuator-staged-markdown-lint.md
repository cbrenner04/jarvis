# Review actuator re-lints staged Markdown before completion

## Problem

Plan/intent write steps lint staged Markdown before finalization (`plan-intent-write-steps-lint`), but the review actuator runs afterward and edits staged spec files without re-linting. Actuator-introduced violations slip past the write-step gate and fail later at CI `lint:md` and/or the completion gate after the draft is committed, stranding finalization (observed 2026-08-07: plan debate actuator `MD038` from nested backticks around `` `(project, branch)` ``).

## Prerequisites

- Plan and intent write steps run `lintStagedMarkdown` on staged Markdown before finalization (`write-loop.ts`, `write-loop-staged-markdown-lint.test.ts`).
- `lintStagedMarkdown` runs `markdownlint-cli2` on staged `*.md` paths with the same `.markdownlint-cli2.jsonc` rules as `bun run lint:md` (`staged-markdown-lint.ts`).
- `write.staged-markdown-lint-reprompt` and `staged_markdown_lint_reprompt` exist for write-step staged-Markdown lint reprompts (`prompts/write/staged-markdown-lint-reprompt.md`, `write-loop.ts`).
- `landReviewedPublicationOutput` is the shared post-actuator completion seam for bare `plan` / `intent` with review and compatibility aliases (`plan-reviewed-light`, `plan-reviewed`, `intent-reviewed`); review actuators may edit staged Markdown after the write-step lint gate and before that landing runs (`workflow-runner.ts`).

## Decision ledger

- Re-run staged Markdown lint on plan-tree and intent-stage landing kinds after the review actuator applies edits and before `landReviewedPublicationOutput` — rules out actuator-introduced violations reaching CI or the completion gate.
- Wire the lint gate at the shared `landReviewedOutputOrFail` / `finishReviewedLanding` completion seam so plan light review, plan debate review, and intent review share one guard — rules out per-profile lint drift and rules out linting only the pre-actuator write-step snapshot.
- Reuse `lintStagedMarkdown` and the write-step staged-path lint contract — rules out a new linter or full-corpus `lint:md` during review.
- On lint failure, bounded actuator reprompt reuses `write.staged-markdown-lint-reprompt` and `staged_markdown_lint_reprompt` with the same rule-id/file-path payload as the write loop — rules out a divergent reprompt surface and rules out hard strand on a fixable authoring slip without retry.
- Deferred to first consumer: review-step retry budget and whether lint reprompt consumes `maxCycles` or a separate bounded counter — pin when wiring the review loop.
- Out of scope: write-step lint gates (`plan-intent-write-steps-lint`); ready-gate `lint:md` rule changes; gate-repair on violations that still reach the ready gate.

## Work

- In `workflow-runner.ts`, evaluate `lintStagedMarkdown` on the staged Markdown root for `plan-tree` and `intent-stage` landing kinds immediately before `landReviewedPublicationOutput` (shared helper or inside `landReviewedOutputOrFail`); skip when landing kind is not one of those or staging has no `*.md`.
- On violation, emit `staged_markdown_lint_reprompt` with rule id and offending file path, inject `write.staged-markdown-lint-reprompt`, and retry the actuator within the pinned review retry budget without calling `landReviewedPublicationOutput` on the first miss.
- Cover plan debate and intent reviewed workflows in `workflow-runner.test.ts` with committed `MD012`/`MD038` violation fixtures and actuator stubs that introduce the violation.
- Update durable docs listed below.

## Acceptance criteria

- [ ] `workflow-runner.test.ts` `review actuator staged Markdown lint violation blocks completion before landing` drives a reviewed plan or intent workflow whose actuator introduces a staged `MD012`/`MD038` violation, asserts completion commit/landing does not run while the violation remains, and fails against pre-fix code that lints only the pre-actuator draft.
- [ ] `workflow-runner.test.ts` `review actuator staged Markdown lint violation reprompts before completion` drives the same violation fixture, asserts a `staged_markdown_lint_reprompt` carrying rule id and file path, asserts the review loop retries the actuator without terminal settlement on the first miss, and fails against pre-fix code that blocks without reprompt.
- [ ] Mutation checkpoint: in `workflow-runner.test.ts`, the test titled `review actuator staged Markdown lint violation blocks completion before landing` carries a `// @mutate` directive (inside the test body) on the post-actuator staged-Markdown lint guard line in `workflow-runner.ts`; the mutation turns that test RED.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — plan/intent review re-lints staged Markdown after the actuator and before completion landing; reprompt semantics.
- `v2/docs/write-behavior.md` — post-actuator staged-Markdown lint on the review completion seam.
- `v2/docs/v1-behaviors.md` — record the post-actuator staged-Markdown lint gate for plan/intent review.
