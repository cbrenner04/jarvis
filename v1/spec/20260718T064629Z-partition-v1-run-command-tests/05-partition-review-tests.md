# 05 - Partition review tests

## Decisions

- Move completion review and `--resume-review` coverage together; rules out duplicating their real-git review environment across partitions.
- Leave agent stream-settlement regressions in `v1/test/run.test.ts`; rules out placing non-review spawn coverage in the review partition.
- Preserve assertions and production code unchanged; rules out changing review semantics during relocation.

## Task checklist

- Move review-phase and `--resume-review` cases from `v1/test/run.test.ts` into a cohesive run-command test file.
- Move their review environment and helpers without importing unrelated fixtures.
- Verify every resulting run-command test file independently and through the v1 suite.

## Acceptance criteria

- [ ] `v1/test/run.test.ts` review-phase and `--resume-review` tests stay green in the new partition.
- [ ] `v1/test/run.test.ts` stays green with its retained preflight, telemetry, and agent stream-settlement coverage.
- [ ] Every resulting non-sandbox run-command test file passes independently and in `bun run test:v1` without relying on unrelated run behaviors sharing the 180-second process allowance.
- [ ] `v1/test/run.sandbox-unrunnable.test.ts` stays green.
- [ ] `bun run typecheck` passes.

## Documentation updates

None — test-only behavior-preserving partition.
