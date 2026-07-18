# 01 - Partition invocation-routing tests

## Decisions

- Group repository routing, additional-read-directory, tier, no-progress, and agent-override cases by invocation selection; rules out partitions based only on source line count.
- Preserve assertions and production code unchanged; rules out combining the move with coverage cleanup.
- Reuse existing test support only where this partition needs it; rules out copying the full original fixture prelude.

## Task checklist

- Move the invocation-selection and escalation cases from `v1/test/run.test.ts` into a cohesive run-command test file.
- Move or share only their required fixtures.
- Verify the retained and new files independently and through the v1 suite.

## Acceptance criteria

- [ ] `v1/test/run.test.ts` repository-routing, additional-read-directory, tier, no-progress, and `patch --agent override` tests stay green in the new partition.
- [ ] `v1/test/run.test.ts` stays green after the extraction.
- [ ] The new invocation-routing test file passes independently and in `bun run test:v1`.
- [ ] `bun run typecheck` passes.

## Documentation updates

None — test-only behavior-preserving partition.
