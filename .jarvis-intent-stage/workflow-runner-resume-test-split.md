---
name: workflow-runner-resume-test-split
---

# Split workflow-runner-resume tests

`workflow-runner-resume.test.ts` (68 tests, 112s) holds one pool slot for its whole run. Split by describe-group into sibling `workflow-runner-resume-*.test.ts` files.

## Decisions

- Test titles identical; no test dropped or rewritten.

## Acceptance criteria

- [ ] Split files together carry exactly the original test titles (title-count comparison against the pre-split file in the PR body).
- [ ] No resulting file exceeds 40s.
- [ ] `bun run typecheck`, `bun run test`, and `bun run check` pass.

## Documentation updates

- None; test layout only.

## Prerequisites

- Intent-landing and staged-lint paths accept an injectable markdown lint dependency that unit tests stub
