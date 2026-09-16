---
name: markdown-lint-test-seam
---

# Markdown lint test seam

Unit tests stop spawning real `markdownlint-cli2`. `validateIntentStage` → `runMarkdownlintAutofix` (`shared/intent-stage.ts`) and `lintStagedMarkdown` (`v2/src/execution/staged-markdown-lint.ts`, called unseamed from `workflow-runner-resume.ts`) spawn a real `bun markdownlint-cli2` per landing; `intent-output` runs ~1.45s per test and `write-loop-staged-markdown-lint` 27s.

## Decisions

- Markdown lint becomes an injectable dependency on the intent-landing and staged-lint paths; production default unchanged.
- Unit tests use a stub; one real-binary test per path stays in the integration slice.

## Acceptance criteria

- [ ] A structural test fails when a file outside the integration slice reaches the real lint runner.
- [ ] One real-binary integration test exists for the intent-landing path and one for the staged-lint path.
- [ ] `intent-output.test.ts` per-test time falls below 0.5s (before/after in the PR body).
- [ ] Test count per slice is unchanged or higher versus the merge base.
- [ ] `bun run typecheck`, `bun run test`, and `bun run check` pass.

## Documentation updates

- `v2/docs/test-writing.md` — lint stub seam.

## Prerequisites
