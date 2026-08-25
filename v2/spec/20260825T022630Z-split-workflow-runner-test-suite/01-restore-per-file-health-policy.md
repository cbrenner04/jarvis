# Restore the per-file health policy

## Problem

- The temporary 420-second ceiling masks unhealthy files, and the old monolith's load-sensitive entry cannot describe the split inventory's evidence-based scheduling policy.

## Prerequisite

- [00](./00-partition-workflow-runner-test-inventory.md) has preserved the complete test inventory and established the 150-second general and 120-second resume limits.

## Decisions

- Classify each resulting file under the documented dated-evidence lane rule; rules out inheriting isolation mechanically or pooling a fragment with a recorded loaded failure.
- Restore `SUPPORTED_HEALTHY_FILE_BUDGET_MS` and its parity pin to `180_000` only after production-runner measurements clear the required margins; rules out retaining the stopgap or lowering it before the split is healthy.
- Record production-policy wall clocks separately from the serial cost baseline; rules out presenting `test:cost` measurements as scheduler-path evidence.
- Update `v2/docs/test-writing.md`, `v2/docs/test-cost-baseline.txt`, and `v2/docs/v1-behaviors.md` with the resulting policy and evidence; rules out leaving the old roster, budget, or audit as durable truth.

## Tasks

- Audit every resulting workflow-runner file under concurrent load and alone, applying the dated-evidence lane rule to `LOAD_SENSITIVE_FILES`.
- Update scheduler-policy tests to assert the exact resulting isolated and pooled files and preserve no-co-runner coverage for every isolated file.
- Drive the resulting files through `runV2TestFiles` with its production spawn, concurrency, isolation, and restored timeout policy; capture each file's wall clock and margin.
- Restore `SUPPORTED_HEALTHY_FILE_BUDGET_MS` and the parity assertion to `180_000`, remove the temporary-stopgap text, and pin the threshold behavior.
- Refresh the aggregate cost roster and its explicitly labeled serial measurements after the file split.
- Update durable documentation with the split inventory, dated lane evidence, 180-second threshold, required split margin, production-policy measurements, and refreshed serial cost baseline.

## Acceptance criteria

- [ ] Production-runner-policy evidence records every resulting workflow-runner file's wall clock at the restored threshold; each is at most 150 seconds, and the resume-path file is at most 120 seconds.
- [ ] `LOAD_SENSITIVE_FILES`, `test/test-slices.test.ts`, and `scripts/run-v2-tests.test.ts` agree on each resulting file's evidence-based lane; isolated files run with no co-runner, while files lacking dated loaded-red/idle-green evidence remain pooled.
- [ ] The updated parity test fails against the pre-fix 420-second baseline and pins `SUPPORTED_HEALTHY_FILE_BUDGET_MS = 180_000` in `test/test-slices.test.ts` (`policy parity: aggregate and v2 files share per-file timeout and subprocess isolation`).
- [ ] The restored timeout accepts 180,000ms and rejects 179,999ms in `scripts/run-v2-tests.test.ts`.
- [ ] `v2/docs/test-writing.md` replaces the monolith audit with the resulting files, dated lane decisions, measured production-policy margins, and the rule to split a file before it reaches 150 seconds under the 180-second health budget.
- [ ] `v2/docs/test-cost-baseline.txt` and the measured aggregate-cost section in `v2/docs/test-writing.md` report the refreshed roster and serial `bun run test:cost` results without conflating them with production-runner timing.
- [ ] `v2/docs/v1-behaviors.md` records the restored 180-second scheduler budget and evidence-based isolation behavior.
- [ ] `bun run typecheck` and `bun run test` pass at the restored threshold.

## Documentation updates

- `v2/docs/test-writing.md` — replace the monolith audit, state the split-before-150-second rule, record file timings and lane evidence, and refresh aggregate cost figures.
- `v2/docs/test-cost-baseline.txt` — refresh the serial per-file roster and totals after the split.
- `v2/docs/v1-behaviors.md` — record the restored 180-second scheduler budget and resulting isolation policy.
