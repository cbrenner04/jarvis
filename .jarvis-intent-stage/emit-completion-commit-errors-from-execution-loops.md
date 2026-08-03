---
name: emit-completion-commit-errors-from-execution-loops
---

# Emit completion-commit errors from execution loops

## Module-boundary surface

- Execution loop: workflow completion and write-loop finalization settlement.

## Problem

- Execution paths return `completionCommitError` to their caller but append a `completion_commit_failed` `loop_finished` record without that message.

## Decisions

- Copy the returned `completionCommitError` into every matching terminal `loop_finished` event — rules out caller-only diagnostics.
- Cover committer throws, no-commit-SHA dirty paths, and write-loop repair, retry, and resume paths — rules out fixing only the initially observed workflow tail.
- Retain normalized `publicationFailure` beside `completionCommitError` when available — rules out replacing structured publication evidence with message-only detail.

## Acceptance criteria

- [ ] `workflow-runner.test.ts` proves committer-throw and no-commit-SHA dirty failures log the same `completionCommitError` returned by the workflow; the regressions fail against baseline.
- [ ] `write-loop.test.ts` proves completion publication and repair-path failures log the same `completionCommitError` returned by the write loop; the regressions fail against baseline.
- [ ] Publication failures retain both `completionCommitError` and normalized `publicationFailure` on the terminal event.
- [ ] Added or modified guards carry `// @mutate` directives on their real source conditions; named pinning tests turn red under each mutation and no production inversion hook is added.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — record workflow completion-tail error logging across commit-failure paths.
- `v2/docs/write-behavior.md` — record write-loop publication and repair error logging.
- `v2/docs/v1-behaviors.md` — record the v2 execution-loop observability change.

## Prerequisites

- Durable `completion_commit_failed` `loop_finished` records can retain optional `completionCommitError` text without a `runs` table migration.
