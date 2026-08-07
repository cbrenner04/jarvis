# Shared gate + primary path

## Problem

Plan/intent write steps lint staged Markdown before finalization (`plan-intent-write-steps-lint`), but the review actuator runs afterward and edits staged spec files without re-linting. Actuator-introduced violations slip past the write-step gate and fail later at CI `lint:md` and/or the completion gate after the draft is committed, stranding finalization (observed 2026-08-07: plan debate actuator `MD038` from nested backticks around `` `(project, branch)` ``).

This subspec ships the shared lint gate and wires it into the **primary** review landing path (`landReviewedOutputOrFail`) with reprompt and exhaustion. The remaining admission paths land in `01`.

## Prerequisites

- Plan and intent write steps run `lintStagedMarkdown` on staged Markdown before finalization (`write-loop.ts`, `write-loop-staged-markdown-lint.test.ts`).
- `lintStagedMarkdown` runs `markdownlint-cli2` on staged `*.md` paths with the same `.markdownlint-cli2.jsonc` rules as `bun run lint:md` (`staged-markdown-lint.ts`).
- `write.staged-markdown-lint-reprompt` and `staged_markdown_lint_reprompt` exist for write-step staged-Markdown lint reprompts (`prompts/write/staged-markdown-lint-reprompt.md`, `write-loop.ts`).
- `landReviewedPublicationOutput` is the shared post-actuator completion seam; `landReviewedOutputOrFail` is the first-pass review landing caller reached by `review-debate` (`workflow-runner.ts`).

## Decision ledger

- Extract a shared helper `lintReviewedStagedMarkdownOrFail` into its own module (`v2/src/execution/reviewed-staged-markdown-lint.ts`) that runs `lintStagedMarkdown` on the staged Markdown root for `plan-tree` and `intent-stage` landing kinds and returns `{ kind: "skip" }` when the landing kind is not one of those or staging has no `*.md`, `{ kind: "pass" }` when clean, `{ kind: "violation", ruleId, filePath, message }` on a rule violation, and `{ kind: "invocation_error", message }` on tooling failure — rules out inlining classification into `workflow-runner.ts` where defense-in-depth would hide it.
- Call the helper immediately before `landReviewedPublicationOutput` in `landReviewedOutputOrFail` (first-pass: after actuator edits) — rules out landing actuator-introduced violations on the primary path.
- On rule violation, emit `staged_markdown_lint_reprompt` with rule id and offending file path, set `pendingStagedMarkdownLintReprompt`, inject `write.staged-markdown-lint-reprompt` into the next actuator invocation, decrement a **separate** bounded lint-reprompt counter (write-step parity; does not consume review `maxCycles`), and `continue` the review loop without calling `landReviewedPublicationOutput` — rules out reprompt AC being unsatisfiable under default `reviewPasses: 1` and rules out terminal settlement on first miss.
- Budget exhaustion (lint-reprompt counter exhausted with violation still present): preserved stage, `landing_failed`, no completion commit — rules out silent promotion of a still-violating draft.
- `invocation_error` follows write-step fail-closed semantics (non-retryable landing failure), reusing the same error kind — rules out divergent operator experience on tooling failure.
- Reuse `lintStagedMarkdown` and the write-step staged-path lint contract — rules out a new linter or full-corpus `lint:md` during review.
- **Fixture reconciliation:** existing `executeWorkflow review dispatch` tests in `workflow-runner.test.ts` that reach `landReviewedOutputOrFail` build staging fixtures whose Markdown is not lint-clean; once the gate is wired they settle `landing_failed`/reprompt instead of `complete`. Give those tests lint-clean staged Markdown (a shared clean-staging test helper or per-fixture cleanup) so all prior review-dispatch tests stay green — rules out shipping a gate that reddens the existing suite.
- Out of scope: the remaining admission paths (`finishReviewedLanding`, `resumePopulatedIntentPublication`) and their coverage (subspec `01`); durable docs (subspec `02`); write-step lint gates; ready-gate `lint:md` changes.

## Work

- Add `v2/src/execution/reviewed-staged-markdown-lint.ts` with `lintReviewedStagedMarkdownOrFail` (and `reviewedStagingDir`, reprompt render/emit helpers as needed), returning the `skip`/`pass`/`violation`/`invocation_error` admission union.
- Wire the helper + reprompt/exhaustion loop into `landReviewedOutputOrFail` in `workflow-runner.ts`.
- Add the three feature tests and the mutation checkpoint below to `workflow-runner.test.ts`, using the `markdownlint-cli2` skip/dep-injection convention from `write-loop-staged-markdown-lint.test.ts`.
- Reconcile the existing `executeWorkflow review dispatch` fixtures broken by the primary-path gate so `bun run test:v2` stays green.

## Acceptance criteria

- [x] `workflow-runner.test.ts` `review actuator staged Markdown lint violation blocks completion before landing` drives a `review-debate` workflow whose actuator introduces a staged `MD012`/`MD038` violation on the primary landing path, asserts no durable promotion (no spec-path write / completion commit) while the violation remains, and fails against pre-fix code with no post-actuator review-path re-lint.
- [x] `workflow-runner.test.ts` `review actuator staged Markdown lint violation reprompts before completion` drives the same fixture, asserts a `staged_markdown_lint_reprompt` carrying rule id and file path, asserts the second actuator invocation carries injected reprompt content (rule id, offending path, staging context), asserts the review loop retries the actuator without terminal settlement on the first miss, and fails against pre-fix code that blocks without reprompt.
- [x] `workflow-runner.test.ts` `review actuator staged Markdown lint exhaustion settles landing_failed with preserved stage` drives a fixture that exhausts the lint-reprompt counter with the violation still present, asserts `landing_failed`, preserved staged output, and no completion commit, and fails against pre-fix code with no exhaustion settlement.
- [x] Mutation checkpoint: in `workflow-runner.test.ts` test `review actuator staged Markdown lint violation blocks completion before landing`, a `// @mutate` directive disabling the **shared** lint classification in `reviewed-staged-markdown-lint.ts` — forcing `lintReviewedStagedMarkdownOrFail` to always return `{ kind: "pass" }` (e.g. `// @mutate v2/src/execution/reviewed-staged-markdown-lint.ts "if (result.kind === \"clean\") return { kind: \"pass\" };" -> "if (true) return { kind: \"pass\" };"`) — turns that test RED. The directive MUST target the shared clean/violation classification, not a per-path guard in `workflow-runner.ts`: the feature is defense-in-depth (later subspec `01` adds sibling gates that would mask a per-path mutation), so only disabling the shared classifier reddens behaviorally. Hand-confirm the mutation reddens via a failed assertion, not a compile error.
- [x] All prior `workflow-runner.test.ts` `executeWorkflow review dispatch` tests stay green (fixtures reconciled to lint-clean staged Markdown).
- [x] `bun run typecheck`, `bun run check`, and `bun run test:v2` pass.

## Documentation updates

None — durable docs land in `02`.
