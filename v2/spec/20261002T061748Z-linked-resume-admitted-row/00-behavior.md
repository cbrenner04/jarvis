# Linked resume executes its admitted row

## Problem

Resuming a linked implement row currently re-enters the snapshot’s base step and strands the admitted ~link-N row.

## Decisions

- Execute the admitted linked row or settle it terminal with a pointer to its replacement; track it through resume, failure and kill while preserving linked/shrink/review/publication sequencing.

## Tasks

- [ ] Implement the behavior and focused regression coverage.

## Acceptance criteria

- [ ] daemon-run-lifecycle-handlers.test.ts and workflow-runner-resume-reconstruct-linked-workflow.test.ts cover resume of paused and resumable failed linked rows: the admitted row settles terminal (with replacement evidence if execution moved), later links remain reachable, and failure or kill cannot strand the admitted row. Tests fail against the pre-fix resume path.
- [ ] `bun run typecheck`, `bun run check`, `bun run lint:md` and `bun run test:v2` pass; integration coverage runs in CI.

## Documentation updates

- v2/docs/operator-runbook.md and v2/docs/v1-behaviors.md describe linked-row resume settlement.
