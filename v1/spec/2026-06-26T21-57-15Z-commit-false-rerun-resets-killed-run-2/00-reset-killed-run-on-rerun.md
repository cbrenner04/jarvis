# Reset an interrupted/timed-out commit:false run on re-run

## Problem

The no-commit re-run auto-reset must reset a run killed mid-progress — the
headline reporter case (intake issue #520): operator Ctrl-C / timeout mid-attempt,
then re-run leaves stale AC ticks and an appended `## Blocker` in the source spec.

At HEAD the capture-on-interrupt code is already wired: `captureInterruptedDelta`
runs on idle/iteration/run timeout (`iteration.ts:846/872/904`) and SIGINT
(`iteration.ts:918`), each persisting via `saveDelta`. But **no test drives an
interrupted no-commit run** — only the storage layer is unit-tested
(`no-commit-delta.test.ts`). The #496 verdict required this regression coverage
(outcome 4) and it was never added, so #520 can report a live failure with CI
green. This subspec proves the behavior on every interrupt path with new
integration tests and fixes whatever a failing path surfaces.

## Decisions

- Capture-on-interrupt is already wired (`iteration.ts:846/872/904/918`); this is verify-and-guard, not green-field — only touch `src` to make a failing path pass. Rules out re-adding persistence the code already has and refactoring working capture code.
- Drive each interrupt path through the existing agent-result seam (`{kind:"error", stderr:"aborted:<reason>"}`, as in `run.test.ts:4046/5237/5342`) plus `__testSetDeltaStateDir`, not real signals/timers. Rules out flaky signal/timer-based tests.
- Assert the SIGINT case at the `runIteration` boundary, where it returns `{kind:"exit",exitCode:130}`; reading the persisted delta there avoids `run.ts`'s real `process.exit(130)` tearing down the test runner. Rules out an unverifiable end-of-process SIGINT test.
- The interrupted-run test appends a **multi-line** `## Blocker` (per #496 verdict outcome 4). Rules out a single-line blocker masking a multi-line strip break.

## Task checklist

- [ ] Add integration tests driving a commit:false run that ticks an AC and appends a multi-line `## Blocker`, then hits each interrupt path (SIGINT, idle/iteration/run timeout); assert a delta is persisted, then re-run the same spec and assert the AC is un-ticked and the blocker fully stripped before agent invocation.
- [ ] If any path fails to persist/reset, fix the capture path in `iteration.ts`/`no-commit-delta.ts` so it passes.
- [ ] Update `v1/docs/run-loop.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] A commit:false run that ticks an AC then exits via SIGINT (`aborted: sigint`) leaves a persisted delta; the next run of that same spec un-ticks that AC before the agent is invoked.
- [ ] The same hold for each of idle-timeout, iteration-timeout, and run-timeout interrupt paths (`aborted: idle-timeout` / `iteration-timeout` / `run-timeout`): the AC ticked during the killed run is un-ticked on re-run.
- [ ] A multi-line `## Blocker` appended during an interrupted commit:false run is stripped in full on re-run (no orphaned body lines remain).
- [ ] A pre-attempt AC (ticked in the authored spec before any run) stays ticked through the re-run reset.
- [ ] Existing `run.test.ts` git:true (commit) tests stay green — the committed path persists no delta and performs no reset on these interrupt paths.

## Documentation updates

- `v1/docs/run-loop.md` — "No-commit re-run auto-reset": confirm the delta is persisted across all interrupt/timeout/Ctrl-C paths (align wording if the fix changes any path's behavior).
- `v2/docs/v1-behaviors.md` — "No-commit re-run auto-reset (new)": record that the delta is persisted on every interrupt/timeout/Ctrl-C path, now regression-tested.
