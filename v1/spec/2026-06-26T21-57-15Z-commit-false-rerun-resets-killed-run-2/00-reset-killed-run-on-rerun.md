# Reset an interrupted/timed-out commit:false run on re-run

## Problem

The no-commit re-run auto-reset must reset a run killed mid-progress — the
headline reporter case (intake issue #520): operator Ctrl-C / timeout mid-attempt,
then re-run leaves stale AC ticks and an appended `## Blocker` in the source spec.

At HEAD the interrupt paths capture the delta **in memory but never persist it**.
All four interrupt branches (idle/iteration/run timeout and SIGINT) call
`captureInterruptedDelta`, which records into `state.noCommitDelta` via
`recordNewlyCheckedAc`/`recordBlocker` and then returns — **none call `saveDelta`**,
the only function that writes the delta to disk. So on re-run `loadDelta` finds
nothing and the prior run's AC ticks and appended `## Blocker` survive unreset.
Bug #520 is live on all four paths. (Only the storage layer is unit-tested in
`no-commit-delta.test.ts`; no test drives an interrupted no-commit run, so #520
reports a live failure with CI green.)

The fix is to persist the delta on interrupt — add `saveDelta` at/after the four
capture sites or inside `captureInterruptedDelta` — and prove it red-first with
new integration tests on every interrupt path.

## Decisions

- The delta is recorded in memory on interrupt but never written to disk; persisting it (a `src` change) is the primary deliverable, not a contingency. Rules out shipping tests with no fix on the false premise that capture is already wired to disk.
- Drive each interrupt path through the existing agent-result seam (`{kind:"error", stderr:"aborted: <reason>"}`) plus `__testSetDeltaStateDir`, not real signals/timers. Rules out flaky signal/timer-based tests.
- The four interrupt tests pin that **each interrupt branch persists** the delta; all branches reach the identical capture+persist path and differ only in the upstream `aborted: <reason>` stderr match, so they pin wiring, not four distinct behaviors. Coverage is justified because this wiring is exactly what regressed.
- Assert the SIGINT case at the `runIteration` boundary, where it returns `{kind:"exit",exitCode:130}`; reading the persisted delta there avoids `run.ts`'s real `process.exit(130)` tearing down the test runner. Rules out an unverifiable end-of-process SIGINT test.
- Prove the re-run resets *before* the agent spawns with a content-based check: assert the prompt/spec snapshot built at run 2's prompt-build point already shows the AC un-ticked. Rules out a timing/ordering race assertion.
- The interrupted-run test appends a **multi-line** `## Blocker` (per #496 verdict outcome 4). Rules out a single-line blocker masking a multi-line strip break.
- Out of scope, deferred to its own subspec: relocation-during-interrupt. The graceful path resolves a moved subspec via `findRelocatedSpecFile`; `captureInterruptedDelta` reads the original `activeSubspecPath` with no relocation handling, so an interrupted run that relocated its subspec captures nothing. #520's path does not relocate, so this stays out of this atomic subspec. Rules out silently ignoring the asymmetry.
- Out of scope: the fix-up-iteration case. On fix-up iterations `activeSubspecPath` is `undefined` so capture no-ops; fix-up runs the ready-gate fix with no subspec AC/blocker delta in that window, so there is nothing to persist. No test warranted.

## Task checklist

- [ ] Persist the interrupt delta: call `saveDelta` at/after the four `captureInterruptedDelta` sites (or inside it) so a killed commit:false run's delta reaches disk.
- [ ] Add integration tests driving a commit:false run that ticks an AC and appends a multi-line `## Blocker`, then hits each interrupt path (SIGINT, idle/iteration/run timeout); assert a delta is persisted, then re-run the same spec and assert (content-based, at prompt-build) the AC is un-ticked and the blocker fully stripped before agent invocation. Tests fail red before the persist fix.
- [ ] Update `v1/docs/run-loop.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] A commit:false run that ticks an AC then exits via SIGINT (`aborted: sigint`) leaves a persisted delta; the next run of that same spec un-ticks that AC, observable in the prompt/spec snapshot built before the agent is invoked.
- [ ] The same holds for each of the idle-timeout, iteration-timeout, and run-timeout interrupt paths (`aborted: idle-timeout` / `iteration-timeout` / `run-timeout`): the AC ticked during the killed run is un-ticked on re-run.
- [ ] A multi-line `## Blocker` appended during an interrupted commit:false run is stripped in full on re-run (no orphaned body lines remain).
- [ ] A pre-attempt AC (ticked in the authored spec before any run) stays ticked through the re-run reset.
- [ ] Existing `run.test.ts` git:true (commit) tests stay green — the committed path persists no delta and performs no reset on these interrupt paths.

## Known limitations

- Driving interrupts through the structured `{kind:"error", stderr:"aborted: <reason>"}` result cannot prove a real signal/timer surfaces as that result before teardown; the end-to-end re-run-reads-disk assertion is the load-bearing, seam-independent check.

## Documentation updates

- `v1/docs/run-loop.md` — "No-commit re-run auto-reset": record that the delta is persisted across all interrupt/timeout/Ctrl-C paths (the fix changes the interrupt paths from in-memory-only to persisted).
- `v2/docs/v1-behaviors.md` — "No-commit re-run auto-reset (new)": record that the delta is now persisted on every interrupt/timeout/Ctrl-C path, regression-tested.
