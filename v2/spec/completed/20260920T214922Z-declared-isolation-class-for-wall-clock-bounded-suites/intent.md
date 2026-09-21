---
name: declared-isolation-class-for-wall-clock-bounded-suites
---

# Test-slice scheduling isolates wall-clock-bounded and subprocess-spawning suites as a declared class

## Problem

`v2/src/commands/workflow.test.ts` and `v2/src/execution/diff-derived-mutation-verifier.test.ts` each pass alone and fail together on an idle machine: the verifier suite spawns up to `MAX_CONCURRENT_VERIFIER_TEST_RUNS` real `bun test` subprocesses, starving the 5 s bounded waits in `workflow.test.ts`. The failing set rotates between runs (measured 2026-09-06: a different trio on a salvage branch, all at exactly 30000 ms), so per-file entries in `LOAD_SENSITIVE_FILES` are whack-a-mole and `main` itself does not pass the local aggregate on an idle machine.

## Decisions

- The isolation signal is a declared class, not a per-incident file list: a file is declared into the class by an in-file marker (an exported constant naming its class: wall-clock-bounded or subprocess-spawning) read by `scripts/test-slice.ts`; rules out a hand-maintained roster like `LOAD_SENSITIVE_FILES` as the mechanism, since the failing set rotates.
- The rule: a wall-clock-bounded file and a subprocess-spawning file never run at the same time; files within one class may still co-run with each other and with unclassified files. Enforced by `scripts/test-slice.ts` producing the run schedule (as a pure function over the real file roster) that `scripts/run-v2-tests.ts` executes; rules out burying the rule in the runner's pool loop where only an end-to-end run can observe it.
- Isolation is bounded, not full serialization of the slice; rules out collapsing the pool to concurrency 1 and paying aggregate wall-clock for every file.

## Acceptance criteria

- [ ] A `test/test-slices.test.ts` test proves the schedule over the real roster never runs `v2/src/commands/workflow.test.ts` and `v2/src/execution/diff-derived-mutation-verifier.test.ts` at the same time; it fails against the current scheduling, which co-runs them.
- [ ] A test proves a synthetic file carrying the wall-clock-bounded marker and one carrying the subprocess-spawning marker are never co-scheduled without either appearing in `LOAD_SENSITIVE_FILES`; it fails against the pre-fix scheduling.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2`, and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/test-writing.md` — the declared isolation class and why wall-clock-bounded assertions cannot share a batch with subprocess-spawning suites.
- `v2/docs/operator-runbook.md` — distinguish this deterministic co-scheduling shape from the ambient-load shape already documented; isolation, not machine quiet, is the discriminator.
- `v2/docs/v1-behaviors.md` — record the declared isolation class as the current scheduling behavior.

## Prerequisites

- `scripts/test-slice.ts` exposes `isLoadSensitive` and `scripts/run-v2-tests.ts` runs load-sensitive files with no co-runners.
- `probeOutsidePathsAtBaseRef` in `ready-finalize.ts` re-runs each failing path in isolation at the merge base.
