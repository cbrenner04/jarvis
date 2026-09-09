# Prove the timed-out killing-test process group is gone

## Problem

`diff-derived-mutation-verifier.test.ts`'s real `while (true)` exit-guard regression (`bounds scanDaemonRunControlHandlerForbiddenSymbols while (true) exit-guard flip via real killing test`) asserts elapsed time, `non-terminating-mutation` classification, source site, restored bytes, and a clean worktree. None of those observe the spawned `bun test` process: the regression passes unchanged if the per-candidate timeout leaves the killing-test group alive as an orphan pegging a core. `shared/subprocess.ts` group mode already escalates SIGTERM→SIGKILL and settles only after confirmed group death, but nothing pins that the verifier's killing-test spawn actually uses it.

## Behavior

The fixture supplies `seams.runScopedTests` as a wrapper around `runDiffDerivedScopedTests` that passes its own `runner: ScopedTestRunner`, whose `runAsync` delegates to the real `realAsyncSubprocessRunner.runAsync` (`shared/subprocess.ts`) while forwarding `processGroup.onGroupId` to record each spawned killing-test pgid — the real `bun test` process still runs. While `verifyDiffDerivedMutations` is hanging on the non-terminating mutant, the regression collects every pgid reported this way, and once the call returns proves each one is gone (`process.kill(-pgid, 0)` raises `ESRCH`). Capture must be non-vacuous: the regression fails if it captured no pgid at all, so a future wiring change that stops spawning under the fixture cannot make the proof trivially true.

## Decisions

- Capture pgids through the existing `processGroup.onGroupId` callback via a `seams.runScopedTests` fixture wrapper, instead of polling the process table for `bun test`; rules out an underspecified "rooted in the fixture worktree" heuristic, a race against concurrent sibling `bun test` runs under `test:v2`, and an unwritten concurrent poller across the 30s hang. Accepted trade: because the fixture supplies its own `seams.runScopedTests`, this regression does not exercise `defaultRunScopedTests`'s own seam resolution (`diff-derived-mutation-verifier.ts:1426`).
- Prove every pgid captured during the hang is gone, not only a single "subject" group; the verifier's scoped-test fan-out (`Promise.allSettled`) can hold more than one concurrent group live at once, so the zero-capture guard alone would miss an under-checked survivor among several.
- Assert absence via `process.kill(-pgid, 0)` throwing `ESRCH`. Pgid reuse can force a false-red (a stale probe against a reused pgid still reads "alive"), but never a false-green (a genuinely live group's own pgid never throws `ESRCH`), so the probe is exact in the direction this regression needs.
- Fail the regression when zero pgids were captured; rules out a silently vacuous guard.
- Add the liveness proof to the existing while-true regression instead of a new test; rules out a second expensive real-spawn fixture and keeps the leak and the classification pinned by one run.
- Keep the existing elapsed-time, `non-terminating-mutation`, source-site, restored-bytes, and clean-worktree assertions in place; rules out trading non-terminating-mutant settlement coverage for cleanup coverage.

## Acceptance criteria

- [ ] The real while-true guard regression in `v2/src/execution/diff-derived-mutation-verifier.test.ts` proves every killing-test process group pgid it captures via `onGroupId` during the hang is absent (`process.kill(-pgid, 0)` throws `ESRCH`) once `verifyDiffDerivedMutations` returns, and fails when it captured zero pgids.
- [ ] That regression retains its elapsed-time, `non-terminating-mutation`, source-site, restored-bytes, and clean-worktree assertions.
- [ ] No `*ForTest`/`*ForTests` member, parameter, module variable, exported function, or exported variable, and no `invert*` parameter, is added to production code for process observation.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/write-behavior.md` — in the diff-derived mutation verification section, note that each scoped killing-test subprocess settles only after its process group is confirmed gone, referencing [`v2-architecture.md` § Steering semantics](./v2-architecture.md#steering-semantics) as the canonical mechanism record rather than restating it.
- `v2/docs/operator-runbook.md` — in the "Leaked ready-gate `bun test` children" gotcha (the three-unbound-sibling-spawns bullet), add that the diff-derived verifier's own bounded per-call timeout now has a regression proving its killing-test group is reaped; do not say the gap is closed — the bullet's unbound-to-run-termination gap, its cleanup condition, and the CPU/parentage attribution guidance elsewhere in the doc stay as-is.
- `v2/docs/v1-behaviors.md` — no update: this changes test coverage and docs only, not runtime behavior.
