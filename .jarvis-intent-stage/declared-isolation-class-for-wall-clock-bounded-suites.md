---
name: declared-isolation-class-for-wall-clock-bounded-suites
---

# Test-slice scheduling isolates wall-clock-bounded and subprocess-spawning suites as a declared class

## Problem

`v2/src/commands/workflow.test.ts` and `v2/src/execution/diff-derived-mutation-verifier.test.ts` each pass alone and fail together on an idle machine: the verifier suite spawns up to `MAX_CONCURRENT_VERIFIER_TEST_RUNS` real `bun test` subprocesses, starving the 5 s bounded waits in `workflow.test.ts`. The failing set rotates between runs (measured 2026-09-06: a different trio on a salvage branch, all at exactly 30000 ms), so per-file entries in `LOAD_SENSITIVE_FILES` are whack-a-mole and `main` itself does not pass the local aggregate on an idle machine.

## Decisions

- The isolation signal is a declared class, not a per-incident file list: suites whose assertions are wall-clock-bounded and suites that spawn `bun test` subprocesses are never admitted to the same concurrent batch by `scripts/run-v2-tests.ts`; rules out enumerating files one incident at a time as the failing set rotates.
- The classification lives in `scripts/test-slice.ts` next to `isLoadSensitive` and is unit-testable as a pure roster predicate over the real file roster; rules out burying the rule in the runner's pool loop where only an end-to-end run can observe it.
- Isolation is bounded co-scheduling, not full serialization of the slice; rules out collapsing the pool to concurrency 1 and paying aggregate wall-clock for every file.

## Acceptance criteria

- [ ] A `test/test-slices.test.ts` test proves `v2/src/commands/workflow.test.ts` and `v2/src/execution/diff-derived-mutation-verifier.test.ts` are never scheduled in the same concurrent batch; it fails against the current roster.
- [ ] A test proves the classification is derived from the declared class rather than a literal per-file list: a suite matching the class is isolated without appearing in `LOAD_SENSITIVE_FILES`; it fails against the pre-fix predicate.
- [ ] Running the union of both files' resolved slice is green ten consecutive times on an idle machine; it fails against the current pairing.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2`, and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/test-writing.md` — the declared isolation class and why wall-clock-bounded assertions cannot share a batch with subprocess-spawning suites.
- `v2/docs/operator-runbook.md` — distinguish this deterministic co-scheduling shape from the ambient-load shape already documented; isolation, not machine quiet, is the discriminator.
- `v2/docs/v1-behaviors.md` — record the declared isolation class as the current scheduling behavior.

## Prerequisites

- `scripts/test-slice.ts` exposes `isLoadSensitive` and `scripts/run-v2-tests.ts` runs load-sensitive files with no co-runners.
- `probeOutsidePathsAtBaseRef` in `ready-finalize.ts` re-runs each failing path in isolation at the merge base.
