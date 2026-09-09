---
name: completion-commit-never-stages-review-verdicts
---

# The completion commit never stages a review verdict file

## Problem

`excludeVerdictFromStaging` (`v2/src/execution/review-intent-enforcement.ts`) is only called from the resume path (`workflow-runner-resume.ts`). Implement lands through `completionCommit`'s `git add -A` over the worktree (`v2/src/execution/completion-commit.ts`), which has no verdict exclusion, so any `verdict-*.md` sitting in the worktree is committed as durable output. `verdict-*.md` is also absent from `.gitignore`, and `lint:md` ignores `**/verdict-*.md`, so nothing else stops it.

## Decisions

- The exclusion lives in `completionStageArgs` as an unconditional `verdict-*.md` pathspec exclusion, so it holds for every landing kind and every target repo regardless of that repo's `.gitignore`; rules out fixing this only in the jarvis repo's ignore file.
- The exclusion is a glob pathspec matching `verdict-*.md` at any depth, not a single resolved path; rules out threading the active run's verdict path into the commit layer, which would leave stale or sibling verdicts stageable.
- The exclusion never `git rm --cached`es an already-tracked verdict; it only narrows staging, matching the existing node_modules exclusion rationale; rules out turning a poisoned repo's next commit into an unrequested deletion.
- `verdict-*.md` is added to this repo's `.gitignore` as defense in depth; rules out relying solely on call-site discipline.
- Resume-path verdict exclusion behavior is unchanged; rules out reworking intent/plan landing while fixing the commit layer.

## Acceptance criteria

- [ ] A test drives a completion commit over a worktree containing a `verdict-*.md` file and asserts the resulting commit tree contains no verdict file; it fails against the pre-fix `completionStageArgs`.
- [ ] A test asserts a verdict file nested inside a spec-tree directory in the worktree is likewise unstaged by the completion commit.
- [ ] A test asserts an already-tracked verdict file is not deleted by the completion commit (staging is narrowed, not a removal).
- [ ] `completion-commit` tests covering the materialized node_modules exclusion stay green (behavior unchanged by the added exclusion).
- [ ] `v2/src/execution/workflow-runner-resume.ts` verdict-exclusion tests stay green (resume landing unchanged).
- [ ] `verdict-*.md` is gitignored in this repo.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — the completion commit never stages review verdict files; state it alongside the existing node_modules exclusion.
- `v2/docs/v1-behaviors.md` — record that completion commits exclude `verdict-*.md`.

## Prerequisites
