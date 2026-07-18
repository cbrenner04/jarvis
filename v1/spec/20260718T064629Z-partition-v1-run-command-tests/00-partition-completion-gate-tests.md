# 00 - Partition completion-gate tests

## Decisions

- Move completion-transition and post-completion gate coverage into one independently runnable file; rules out leaving gate-heavy fixtures in the general run suite.
- Preserve assertions and production code unchanged; rules out rewriting gate coverage during relocation.
- Extract only helpers shared by the retained and moved tests; rules out a suite-wide fixture framework.

## Task checklist

- Move completion ready-gate and gate-tier cases from `v1/test/run.test.ts` into a cohesive run-command test file.
- Share the minimum fixture setup required by both files.
- Verify the retained and new files independently and through the v1 suite.

## Acceptance criteria

- [ ] `v1/test/run.test.ts` completion-transition ready-gate and post-completion gate-tier tests stay green in the new partition.
- [ ] `v1/test/run.test.ts` stays green after the extraction.
- [ ] The new completion-gate test file passes independently and in `bun run test:v1`.
- [ ] `bun run typecheck` passes.

## Documentation updates

None — test-only behavior-preserving partition.
