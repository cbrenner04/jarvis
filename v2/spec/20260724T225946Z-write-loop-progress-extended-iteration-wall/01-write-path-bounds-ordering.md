# Write-path bounds ordering at config load

## Problem

Review roles do not validate `idleOutputTimeoutMs` against iteration bounds. Inverted ordering
would make the idle budget or wall segment meaningless relative to the hard ceiling without a
load-time error.

## Decisions

- Validate ordering when direct `jarvis write` and workflow write steps resolve machine bounds; rules out review-role or daemon-only checks.
- Reject `idleOutputTimeoutMs` greater than resolved `iterationTimeoutMs` when idle is enabled (`> 0`); rules out treating idle `0` (disabled) as an ordering violation.
- Reject resolved `iterationTimeoutMs` greater than resolved `iterationCeilingMs`; rules out silently clamping or ignoring an inverted ceiling.
- Error text names both compared numeric bounds and their config keys; rules out generic "invalid config" without operands.
- Machine config key for the ceiling is `iterationCeilingMs`; rules out overloading `iterationTimeoutMs` for both segment and ceiling.
- Default `iterationCeilingMs` when absent is `1_800_000` ms; rules out defaulting the ceiling to the wall segment (ceiling would never bind under continuous output).
- Resolve and persist `iterationCeilingMs` on workflow write steps alongside `iterationTimeoutMs` for resume/revise; rules out resume reverting to a flat timer without a ceiling.
- Centralize readers and the ordering check in the machine-config loader seam used by `readIterationTimeoutMs`; rules out duplicating validation only in CLI tests.

## Tasks

- [ ] Add `readIterationCeilingMs` and `readIdleOutputTimeoutMs` (or equivalent) with v1-aligned defaults for write-path resolution.
- [ ] Add `validateWritePathIterationBounds` (or equivalent) and call it from `write` and workflow write-step assembly before daemon dispatch.
- [ ] Propagate resolved `iterationCeilingMs` through workflow snapshots and daemon write steps.
- [ ] Add loader/CLI tests for both ordering violations and guard inversion.
- [ ] Update durable operator config docs and v1 parity baseline.

## Acceptance criteria

- [ ] `machine-config-loader.test.ts` rejects `idleOutputTimeoutMs` above `iterationTimeoutMs` with a message that includes both keys and both numeric values; inverting the comparison passes load.
- [ ] `machine-config-loader.test.ts` rejects `iterationTimeoutMs` above `iterationCeilingMs` with a message that includes both keys and both numeric values; inverting the comparison passes load.
- [ ] `write.test.ts` surfaces the same ordering failure when `jarvis write` resolves machine config before starting the loop; a valid ordering reaches `executeWriteLoop` with resolved `iterationTimeoutMs` and `iterationCeilingMs`.
- [ ] `workflow-runner.test.ts` (or focused workflow CLI test) preserves resolved `iterationCeilingMs` on write steps through snapshot resume/revise reconstruction.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/install-and-config.md` — `iterationTimeoutMs` wall segment, `iterationCeilingMs` ceiling, `idleOutputTimeoutMs` ordering constraints on the write path.
- `v2/docs/v1-behaviors.md` — v2 progress-extended wall plus ceiling vs v1 flat `iterationTimeoutMs` parity baseline.
