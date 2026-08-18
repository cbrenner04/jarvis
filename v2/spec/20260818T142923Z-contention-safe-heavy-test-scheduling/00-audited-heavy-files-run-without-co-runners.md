# 00 - Audited heavy files run with no co-runners

## Problem

`LOAD_SENSITIVE_FILES` (`scripts/test-slice.ts`) lists two files, so every other socket/timing/subprocess-heavy v2 file still runs in the bounded pool. `v2/src/daemon/daemon-resume.test.ts` passes 0-fail in isolation (~6s, 4 straight runs) but produced 106 failures / 354 when co-run with `v2/src/execution/workflow-runner.test.ts` under load on 2026-08-17; `workflow-runner.test.ts` tipped over the per-file agent wall clock (`error: "agent" test run timed out or was killed on file …`) on #2879, #2888, and post-merge `main` the same day, each passing a re-run with no code change. Nothing records which files were audited for this class or why a candidate stayed pooled, so the class keeps growing back into the pool.

## Decision ledger

- Membership joins on dated failure evidence — a CI/full-suite observation already on record, or a local concurrent-load run reproducing it — not on local reproduction alone; rules out an audit that lands empty because the operator's box will not reproduce a loaded-runner flake.
- `v2/src/execution/workflow-runner.test.ts` joins the lane in this change; `workflow-runner-test-concurrent-load-isolation` shortens it later but is not a prerequisite here; rules out deferring the only agent-timeout offender to a spec that has not landed.
- Audit candidates that survive the load run stay pooled, and the audit result (candidate set, date, which joined, which stayed) is recorded in `v2/docs/test-writing.md`; rules out serializing all of `v2/src/daemon/**` and paying its wall clock for files with no observed failure.
- The isolation pin test carries its own literal audited roster instead of iterating `LOAD_SENSITIVE_FILES`; a test that iterates the production list cannot detect an entry being removed, which would make the keystone hollow.
- Aggregate `bun run test` wall clock is re-measured in this change and `v2/docs/test-writing.md`'s figure and regression bar are replaced by the new distribution (the prior 326s mean / ≤335s bar assumed `workflow-runner.test.ts` ran pooled); rules out leaving a bar the change is known to break.
- Ready-gate step budgets (`TEST_STEP_BUDGET_MS`, `DEFAULT_TIMEOUT_MS` in `scripts/ready.ts`) stay unchanged; re-sizing them is [#2181](https://github.com/cbrenner04/jarvis/issues/2181). If the re-measured aggregate exceeds half of `TEST_STEP_BUDGET_MS`, `v2/docs/test-writing.md` records the shrunken headroom instead. Rules out bundling a gate-budget resize into a scheduling change.
- No `v2/docs/v1-behaviors.md` entry: suite execution scheduling is repo tooling, not harness behavior with a v1 parity baseline; `v2/docs/test-writing.md` is the durable home. Rules out extending the parity catalog with build-tooling policy.

## Task checklist

- Audit the candidate set: agent-slice files under `v2/src/daemon/**` that open a Unix socket, an `IpcClient`, or `mkdtemp` state (`daemon-process-log`, `daemon-queue-promotion`, `daemon-reconciliation`, `daemon-resume`, `daemon-state-store-lock-timeout`, `daemon-wait-run-completion`, `daemon-workflow-start`, `live-daemon-socket-discovery`, `memory-watermark`, `pipeline-execution`, `pipeline-stage-resolve`, `write-loop-binding-source-guard`), plus `v2/src/execution/workflow-runner.test.ts`. Run the candidate roster through `scripts/run-v2-tests.ts` at default concurrency for at least two rounds and record per-candidate outcome and isolated wall clock.
- Add each qualifying candidate to `LOAD_SENSITIVE_FILES` with a comment naming the observed failure and its date, matching the existing entry style; keep each entry's path literal appearing exactly once in the file (comments must not repeat the path verbatim) so mutation directives resolve.
- Add the co-runner pin to `scripts/run-v2-tests.test.ts` with its own literal audited roster and an injected spawn recording per-file start/end sequence numbers.
- Add the membership assertion for the audited paths to `test/test-slices.test.ts`.
- Measure aggregate `bun run test` wall clock across at least two consecutive runs on quiet hardware; record the new mean/range and regression bar.
- Update `v2/docs/test-writing.md`: lane join rule, the audit record, refreshed wall-clock figures.

## Acceptance criteria

- [ ] `scripts/run-v2-tests.test.ts` test `every audited heavy file runs with no co-runner in either direction` fails against the pre-fix code and passes after: it drives `runV2TestFiles("agent", [...auditedFiles, ...pooledFillers], recordingSpawn, "v2", 3)` where `auditedFiles` is a literal roster of the audited real paths and `recordingSpawn` stamps a monotonic start/end sequence per file, then asserts (1) no audited file's `[start, end]` window intersects any other file's window, and (2) the filler files do overlap up to the concurrency limit, so a roster that never overlaps cannot pass the test vacuously.
- [ ] `test/test-slices.test.ts` test `audited heavy files are classified load-sensitive` fails against the pre-fix code and passes after: `isLoadSensitive` returns true for `v2/src/daemon/daemon-resume.test.ts`, `v2/src/execution/workflow-runner.test.ts`, and every other path the audit added, and returns false for at least one audited candidate that stayed pooled.
- [ ] Every explicit `LOAD_SENSITIVE_FILES` entry added by this change carries a comment naming the observed failure and its date, in the style of the two existing entries.
- [ ] `scripts/run-v2-tests.test.ts` — `every audited heavy file runs with no co-runner in either direction`; Keystone checkpoint: an in-body `// @mutate scripts/test-slice.ts "v2/src/execution/workflow-runner.test.ts" -> "v2/src/execution/workflow-runner-pooled.test.ts"` directive drops the headline offender out of the lane, so it runs pooled and its recorded window intersects a filler file's window, turning this test red.
- [ ] `test/test-slices.test.ts` — `audited heavy files are classified load-sensitive`; Mutation checkpoint: an in-body `// @mutate scripts/test-slice.ts "v2/src/daemon/daemon-resume.test.ts" -> "v2/src/daemon/daemon-resume-pooled.test.ts"` directive removes the second confirmed offender from lane membership, turning this test red — proving the pin covers each audited entry, not only the keystone path.
- [ ] `v2/docs/test-writing.md` § Load-sensitive isolation states the join rule (a file joins when a dated concurrent-load or CI observation shows it red under load and green idle, and the entry comment records that observation) and records this audit: date, the candidate set definition, which candidates joined, and which stayed pooled.
- [ ] `v2/docs/test-writing.md` replaces the 326s mean / 321-330s range / ≤335s regression bar with the aggregate `bun run test` wall clock measured on this branch across at least two consecutive runs, labeled with its date and command, keeping the prior figures labeled as superseded rather than deleting them.
- [ ] `v2/docs/test-writing.md` § Ready-gate step budgets still records `TEST_STEP_BUDGET_MS` and `DEFAULT_TIMEOUT_MS` as unchanged, restated against the new measured aggregate.
- [ ] Existing `scripts/run-v2-tests.test.ts` `load-sensitive isolation` tests and `test/test-slices.test.ts` slice-boundary tests stay green (scheduling mechanics unchanged by this membership change).
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/test-writing.md` — § Load-sensitive isolation: lane join rule and this audit's record (candidate set, date, joined vs stayed pooled); § Bounded concurrency pool: refreshed aggregate `bun run test` wall clock and regression bar; § Ready-gate step budgets: restated headroom against the new figure.

## Implementer notes

- `runV2TestFiles` already gives isolated files no co-runners in either direction; this subspec changes membership and its pin, not the scheduler.
- Use synthetic filler names (`filler-a.test.ts`, …) for the pooled side of the pin so a later audit adding a real daemon file cannot silently turn the filler into a lane member.
- Record sequence numbers from a counter, not a clock — the pin must not depend on timer resolution.
- Add no test-only inversion hooks; both directives mutate the real `LOAD_SENSITIVE_FILES` entries.
- `test/test-slices.test.ts` also asserts the runner's literal budget text; that assertion belongs to subspec 01 and should not be touched here.
