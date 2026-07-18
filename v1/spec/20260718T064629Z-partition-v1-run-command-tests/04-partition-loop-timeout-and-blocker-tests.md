# 04 - Partition loop, timeout, and blocker tests

## Decisions

- Group loop-only mode, deterministic timeout bookkeeping, and blocker adjudication as iteration-control coverage; rules out moving real-process watchdog tests from the sandbox-unrunnable suite.
- Preserve assertions and production code unchanged; rules out revising timeout or blocker behavior during relocation.
- Keep fake-clock and fake-agent seams local or narrowly shared; rules out coupling this partition to unrelated review fixtures.

## Task checklist

- Move loop-only, deterministic timeout, and blocker cases from `v1/test/run.test.ts` into a cohesive run-command test file.
- Move or share only their required fixtures.
- Verify both timeout surfaces and the v1 suite.

## Acceptance criteria

- [ ] `v1/test/run.test.ts` loop-only, timeout bookkeeping, and blocker-handling tests stay green in the new partition.
- [ ] `v1/test/run.test.ts` stays green after the extraction.
- [ ] The new loop, timeout, and blocker test file passes independently and in `bun run test:v1`.
- [ ] `v1/test/run.sandbox-unrunnable.test.ts` stays green.
- [ ] `bun run typecheck` passes.

## Documentation updates

None — test-only behavior-preserving partition.
