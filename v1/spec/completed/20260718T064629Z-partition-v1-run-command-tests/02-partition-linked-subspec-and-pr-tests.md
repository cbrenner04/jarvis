# 02 - Partition linked-subspec and PR tests

## Decisions

- Group linked-subspec progression, WIP handling, and draft-PR publication as one lifecycle partition; rules out separating tightly coupled commit-and-publish fixtures.
- Preserve assertions and production code unchanged; rules out changing lifecycle semantics while moving coverage.
- Share lifecycle fixtures narrowly; rules out duplicating git and PR stubs across test files.

## Task checklist

- Move linked-subspec progression, partial-progress, and draft-PR cases from `v1/test/run.test.ts` into a cohesive run-command test file.
- Move or share only their required lifecycle fixtures.
- Verify the retained and new files independently and through the v1 suite.

## Acceptance criteria

- [x] `v1/test/run.test.ts` linked-subspec progression, WIP commit, and draft-PR tests stay green in the new partition.
- [x] `v1/test/run.test.ts` stays green after the extraction.
- [x] The new linked-subspec and PR test file passes independently and in `bun run test:v1`.
- [x] `bun run typecheck` passes.

## Documentation updates

None — test-only behavior-preserving partition.
