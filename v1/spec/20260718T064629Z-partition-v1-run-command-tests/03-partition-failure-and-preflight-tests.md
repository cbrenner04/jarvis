# 03 - Partition failure and preflight tests

## Decisions

- Group iteration limits, agent outcome handling, output reporting, spec resolution, and project-root preflights as terminal run outcomes; rules out scattering failure-path fixtures by exit code.
- Preserve assertions and production code unchanged; rules out normalizing error behavior during relocation.
- Keep process-backed timeout coverage outside this partition; rules out mixing deterministic failures with sandbox-unrunnable timing tests.

## Task checklist

- Move deterministic terminal-outcome and late-preflight cases from `v1/test/run.test.ts` into a cohesive run-command test file.
- Move or share only their required fixtures.
- Verify the retained and new files independently and through the v1 suite.

## Acceptance criteria

- [x] `v1/test/run.test.ts` max-iteration, quota, agent-error, output-tail, spec-resolution, active-spec marker, disambiguation, and missing-project-root tests stay green in the new partition.
- [x] `v1/test/run.test.ts` stays green after the extraction.
- [x] The new failure and preflight test file passes independently and in `bun run test:v1`.
- [x] `bun run typecheck` passes.

## Documentation updates

None — test-only behavior-preserving partition.
