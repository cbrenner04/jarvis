# Declared isolation class, schedule, and runner batch loop

## Problem

`workflow.test.ts` polls until a workflow settles (`waitForCompletion`, 25 ms interval) and relies on bunfig's 30000 ms per-test timeout; when `diff-derived-mutation-verifier.test.ts` co-runs and saturates the CPU with nested `bun test` pools, the polls miss the timeout. Observed 2026-09-06 on a salvage branch: a rotating trio failing at exactly 30000 ms. Both suites are pooled together today (neither is in `LOAD_SENSITIVE_FILES`, neither matches the sandbox suffix, so `isLoadSensitive` is false for both). `LOAD_SENSITIVE_FILES` can only say "this file runs alone"; it cannot say "these two kinds never co-run". `probeOutsidePathsAtBaseRef` already re-runs failing paths isolated in CI, so the value here is the local aggregate (`bun run test:v2` passing on an idle machine).

## Decisions

- Two classes, declared in the test file by `export const TEST_ISOLATION_CLASS = "poll-until-done" | "subprocess-spawning"`; the scheduler reads it. Rules out a path-keyed roster, which cannot express a mutual-exclusion relation between kinds.
- The reader matches the one-line declaration textually over the file source, not via the TypeScript AST.
- The reader takes `(file, source)`; the planner takes an injected `classOf(file)`. Synthetic rosters supply sources in memory; the planner never reads the filesystem.
- A file matching both classes' markers is a hard error; an unrecognized class string is a hard error, not silent pooling.
- Fixed batch order: (1) unclassified + poll-until-done files, (2) subprocess-spawning files, (3+) one single-file batch per `isLoadSensitive` file in roster order. Order is observable through `stopAdmitting`. Unclassified files ride in batch 1, not with the spawners, where they would be starved as today.
- `isLoadSensitive` wins over class: a file both declared and load-sensitive gets a single-file batch.
- Author-facing rule: `LOAD_SENSITIVE_FILES` = the file needs solitude under machine load; declared class = the file conflicts with a specific other kind. `LOAD_SENSITIVE_FILES` keeps its entries.
- Sufficiency is narrow by design: only declared spawners are kept out of batch 1. Undeclared subprocess-spawning suites (`runtime-smoke-verifier`, real-git fixtures, `ready-finalize`) stay pooled with poll-until-done files; they are lighter than the verifier's up-to-N nested full `bun test` pools. Deferred to first consumer: declaring further spawners or deriving the class from file contents — pin when a third suite hits this shape.
- The declaration contract is v2-lane only: `scripts/run-shared-tests.ts` runs agent mode as one `bun test --parallel` over `shared/`, `test/`, `scripts/` with no pool and no `isLoadSensitive`. Deferred to first consumer: shared-lane honoring of the class — pin when a shared suite needs it.
- `runV2TestFiles` iterates the schedule's batches in order under the existing bounded pool at the resolved concurrency, each batch fully draining before the next; it no longer derives a `poolable`/`isolated` split. Rules out overlapping batch tails and collapsing to concurrency 1.
- `stopAdmitting` carries across batches: `agent` mode keeps admitting past a timeout and stops on a plain failure, every other mode stops on either; a stop prevents later batches from starting.
- Deliberate behavior change: a first failure in an earlier batch now prevents later batches from starting (files that previously pooled into one phase may no longer be admitted). Route to `v1-behaviors.md`. Accepted: the batches exist to keep suites from corrupting each other’s timing, so results measured after an earlier failure were produced under the very scheduling state this fix removes. The cost is that one early failure shrinks what a single `test:v2` run reports — read a failed aggregate as “first failure”, not “only failure”.
- Per-file timeout, contiguous captured-output flush, and the `JARVIS_READY_FAILING_TEST_FILE` record are unchanged.
- A serialized batch costs roughly its own duration in aggregate wall clock; no wall-clock bound is asserted.

## Acceptance criteria

- [ ] `v2/src/commands/workflow.test.ts` declares `poll-until-done` and `v2/src/execution/diff-derived-mutation-verifier.test.ts` declares `subprocess-spawning` via the in-file marker, and neither is in `LOAD_SENSITIVE_FILES`.
- [ ] A `scripts/run-v2-tests.test.ts` test drives `runV2TestFiles` with an injected gated spawn at concurrency ≥ 2 over the real paths `v2/src/commands/workflow.test.ts` and `v2/src/execution/diff-derived-mutation-verifier.test.ts` (sources read from disk) and asserts they are never in flight together; it fails against the pre-fix runner, which pools both (reachable on `main`: `isLoadSensitive` is false for both).
- [ ] A `test/test-slices.test.ts` test reads the real source of `v2/src/commands/workflow.test.ts` (the `waitForCompletion` poll site) and asserts the reader classifies it `poll-until-done`.
- [ ] A `test/test-slices.test.ts` test over a synthetic in-memory roster — one poll-until-done file, one subprocess-spawning file, neither in `LOAD_SENSITIVE_FILES` — asserts the two never share a batch, and that unclassified files and same-class files may share one.
- [ ] A test asserts a file that is both declared and `isLoadSensitive` gets a single-file batch, and that batches follow the fixed order.
- [ ] A test asserts a file matching both markers throws, and an unrecognized class string throws.
- [ ] A `scripts/run-v2-tests.test.ts` test asserts a failure in an earlier batch stops later batches from starting in a non-`agent` mode, and that `agent` mode keeps admitting past a timeout but stops on a plain failure.
- [ ] Existing `scripts/run-v2-tests.test.ts` pool, timeout, output-attribution, and failing-file-record tests stay green.
- [ ] Existing `test/test-slices.test.ts` `isLoadSensitive` tests stay green.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.
- [ ] `bun run test:shared` passes.

## Documentation updates

- `v2/docs/test-writing.md` — the two classes, the in-file marker form, why a poll-until-done suite cannot share a batch with a subprocess-spawning suite, the author-facing rule vs `LOAD_SENSITIVE_FILES`, v2-lane-only scope, and the runner's ordered-batch loop replacing the `poolable`/`isolated` split.
- `v2/docs/operator-runbook.md` — distinguish the deterministic co-scheduling shape (two suites pass alone, fail together at the 30000 ms timeout) from the ambient-load shape: the discriminator is whether the failing pair passes alone and fails together on an idle machine; the fix is declaring a class, not extending `LOAD_SENSITIVE_FILES`.
- `v2/docs/v1-behaviors.md` — record the declared isolation class, batched schedule, and cross-batch stop-on-failure as current test-slice scheduling behavior.
