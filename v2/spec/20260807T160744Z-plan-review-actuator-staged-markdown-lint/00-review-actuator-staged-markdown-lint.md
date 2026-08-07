# Review actuator re-lints staged Markdown before completion

## Problem

Plan/intent write steps lint staged Markdown before finalization (`plan-intent-write-steps-lint`), but the review actuator runs afterward and edits staged spec files without re-linting. Actuator-introduced violations slip past the write-step gate and fail later at CI `lint:md` and/or the completion gate after the draft is committed, stranding finalization (observed 2026-08-07: plan debate actuator `MD038` from nested backticks around `` `(project, branch)` ``).

## Prerequisites

- Plan and intent write steps run `lintStagedMarkdown` on staged Markdown before finalization (`write-loop.ts`, `write-loop-staged-markdown-lint.test.ts`).
- `lintStagedMarkdown` runs `markdownlint-cli2` on staged `*.md` paths with the same `.markdownlint-cli2.jsonc` rules as `bun run lint:md` (`staged-markdown-lint.ts`).
- `write.staged-markdown-lint-reprompt` and `staged_markdown_lint_reprompt` exist for write-step staged-Markdown lint reprompts (`prompts/write/staged-markdown-lint-reprompt.md`, `write-loop.ts`).
- `landReviewedPublicationOutput` is the shared post-actuator completion seam for bare `plan` / `intent` with review and compatibility aliases (`plan-reviewed-light`, `plan-reviewed`, `intent-reviewed`); review actuators may edit staged Markdown after the write-step lint gate and before that landing runs (`workflow-runner.ts`).

## Decision ledger

- One shared pre-landing `lintStagedMarkdown` step for `plan-tree` and `intent-stage` kinds, invoked from every caller that reaches `landReviewedPublicationOutput` on those kinds: `landReviewedOutputOrFail`, `finishReviewedLanding`, and `resumePopulatedIntentPublication` — rules out checkpoint/resume bypasses where actuator-introduced violations still promote.
- First-pass review paths lint after actuator edits; `resumePopulatedIntentPublication` lints on replay-finalization only (no actuator re-invocation) — rules out resume skipping post-actuator violations already on disk.
- Reuse `lintStagedMarkdown` and the write-step staged-path lint contract — rules out a new linter or full-corpus `lint:md` during review.
- Review-path `lintStagedMarkdown` `invocation_error` follows write-step fail-closed semantics (non-retryable landing failure), reusing the same function and error kinds — rules out divergent operator experience on harness/tooling failure.
- On rule violation (not `invocation_error`), bounded actuator reprompt reuses `write.staged-markdown-lint-reprompt` and `staged_markdown_lint_reprompt` with the same rule-id/file-path payload as the write loop — rules out a divergent reprompt surface and rules out hard strand on a fixable authoring slip without retry.
- Lint-reprompt retry uses a separate bounded counter (write-step parity); it does not consume review `maxCycles` — rules out reprompt AC being unsatisfiable under default `reviewPasses: 1`.
- Post-actuator lint failure on first-pass paths sets `pendingStagedMarkdownLintReprompt`, `continue`s the review loop, and re-admits the actuator with injected reprompt (same seam as review-debate actuator-only retry admission) — rules out satisfying the reprompt AC with terminal `invocation_failure` / `landing_failed` on first miss.
- Budget exhaustion (lint-reprompt counter exhausted with violation still present): write-step parity — preserved stage, `landing_failed`, resumable via `resumePopulatedIntentPublication` (which re-runs lint without actuator) — rules out ambiguous operator UX given existing resume infrastructure.
- Out of scope: write-step lint gates (`plan-intent-write-steps-lint`); ready-gate `lint:md` rule changes; gate-repair on violations that still reach the ready gate; non-durable profile review (`landing.kind: "none"`).

## Work

- Extract a shared helper (e.g. `lintReviewedStagedMarkdownOrFail`) that runs `lintStagedMarkdown` on the staged Markdown root for `plan-tree` and `intent-stage` kinds and skips when landing kind is not one of those or staging has no `*.md`; call it immediately before every `landReviewedPublicationOutput` on those kinds from `landReviewedOutputOrFail`, `finishReviewedLanding`, and `resumePopulatedIntentPublication`.
- On first-pass review paths (`landReviewedOutputOrFail`, `finishReviewedLanding`): after actuator edits, run the helper; on rule violation, emit `staged_markdown_lint_reprompt` with rule id and offending file path, set `pendingStagedMarkdownLintReprompt`, inject `write.staged-markdown-lint-reprompt` into the next actuator invocation, decrement the separate lint-reprompt counter, and `continue` the review loop without calling `landReviewedPublicationOutput`.
- On `resumePopulatedIntentPublication`: run the helper only (replay-finalization); on violation, settle `landing_failed` with preserved stage (no actuator retry).
- Cover `review-debate` (plan debate) and intent reviewed workflows in `workflow-runner.test.ts` with committed `MD012`/`MD038` violation fixtures and actuator stubs that introduce the violation; use the same `markdownlint-cli2` skip/dep-injection convention as `write-loop-staged-markdown-lint.test.ts`.
- Update durable docs listed below.

## Acceptance criteria

- [ ] `workflow-runner.test.ts` `review actuator staged Markdown lint violation blocks completion before landing` drives a `review-debate` workflow (and intent reviewed coverage in the same or companion test) whose actuator introduces a staged `MD012`/`MD038` violation, asserts no durable promotion (no spec-path write / completion commit) while the violation remains, and fails against pre-fix code with no post-actuator review-path re-lint so actuator-introduced violations reach landing.
- [ ] `workflow-runner.test.ts` `review actuator staged Markdown lint violation reprompts before completion` drives the same violation fixture on `review-debate`, asserts a `staged_markdown_lint_reprompt` carrying rule id and file path, asserts the second actuator invocation carries injected reprompt content (rule id, offending path, staging context), asserts the review loop retries the actuator without terminal settlement on the first miss, and fails against pre-fix code that blocks without reprompt.
- [ ] `workflow-runner.test.ts` `review actuator staged Markdown lint exhaustion settles landing_failed with preserved stage` drives a fixture that exhausts the lint-reprompt counter with violation still present, asserts `landing_failed`, preserved staged output, and no completion commit, and fails against pre-fix code with no exhaustion settlement.
- [ ] Mutation checkpoint: in `workflow-runner.test.ts`, the test titled `review actuator staged Markdown lint violation blocks completion before landing` carries a `// @mutate` directive (inside the test body) on the post-actuator staged-Markdown lint guard line in `workflow-runner.ts`; the mutation turns that test RED.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — plan/intent review re-lints staged Markdown after the actuator and before completion landing; all promotion admission paths; reprompt and exhaustion semantics.
- `v2/docs/write-behavior.md` — post-actuator staged-Markdown lint on the review completion seam.
- `v2/docs/v1-behaviors.md` — record the post-actuator staged-Markdown lint gate for plan/intent review.
- `v2/docs/prompts.md` — cross-behavior reuse of `write.staged-markdown-lint-reprompt` on the review path; note shared write/review staging context.
- `v2/docs/operator-runbook.md` — `landing_failed` + resume guidance when lint-reprompt budget is exhausted.
