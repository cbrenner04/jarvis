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

- [ ] Plan and intent review-actuator paths lint staged Markdown after applying edits; a pinning test injects an actuator edit that introduces a Markdown-lint violation and asserts the pass is caught before completion commit/landing; fails against the pre-fix path that lints only the pre-actuator draft.
- [ ] Mutation checkpoint: in that pinning test, a `// @mutate` directive disabling the post-actuator lint pass turns the regression RED.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — the review actuator re-lints staged Markdown before the completion commit.

## Prerequisites

- Plan and intent write steps run `lintStagedMarkdown` on staged Markdown before finalization.
- `lintStagedMarkdown` runs `markdownlint-cli2` on staged `*.md` paths with the same `.markdownlint-cli2.jsonc` rules as `bun run lint:md`.
- `write.staged-markdown-lint-reprompt` and `staged_markdown_lint_reprompt` exist for write-step staged-Markdown lint reprompts.
- Plan (`plan-reviewed-light`, `plan-reviewed`) and intent (`intent-reviewed`) review steps invoke an actuator that may edit staged Markdown after the write-step lint gate and before deferred landing.
