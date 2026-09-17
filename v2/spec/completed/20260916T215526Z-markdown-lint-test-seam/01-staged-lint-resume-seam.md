# 01 — Staged-lint seam on plan resume

`lintPlanRecoveryStage` in `v2/src/execution/workflow-runner-resume.ts` calls `lintStagedMarkdown` without deps, so resume tests spawn the real binary; `v2/src/execution/write-loop-staged-markdown-lint.test.ts` takes ~27s.

## Decisions

- Forward the existing `LintStagedMarkdownDeps.runner` from resume deps into `lintPlanRecoveryStage`; default unchanged — rules out a new lint abstraction.
- Unit tests (including `write-loop-staged-markdown-lint.test.ts` and daemon resume/recover tests that call `lintStagedMarkdown` directly) use a stub runner; one real-binary staged-lint test lives in the integration slice.

## Tasks

- [ ] Add optional runner to the resume path in `v2/src/execution/workflow-runner-resume.ts`.
- [ ] Stub it in unit tests that reach staged lint; keep one real-binary integration test.

## Acceptance criteria

- [x] A unit test asserts an injected runner is used by plan-recovery staged lint; it fails against the pre-change code.
- [x] One real-binary integration test covers the staged-lint path and runs under `bun run test:integration:v2`.
- [x] `v2/src/execution/staged-markdown-lint.test.ts` stays green.
- [x] Test count per slice is unchanged or higher versus the merge base.
- [x] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2`, and `bun run check` pass.

## Documentation updates

- `v2/docs/test-writing.md` — staged-lint stub seam.
