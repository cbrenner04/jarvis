---
name: ready-gate-per-step-budgets
---

# Per-step ready-gate budgets with a total ceiling

## Problem

`scripts/ready.ts` spends one 10-minute budget across every step
(`remainingMs = max(0, deadlineMs - elapsedMs)`, `DEFAULT_TIMEOUT_MS`). The aggregate suite alone
takes ~9 minutes, so `check`, `typecheck`, `install`, tests, and `lint:md` fight over one wall
clock. Worse, the flake-retry re-runs the *entire* test step charged to `serialElapsed`, so a flake
at minute 5 gives the retry 5 minutes to do a 9-minute job — the retry is guaranteed to be killed
rather than to answer the question. The kill message names only the total (`deadline exceeded after
600000ms`), never the step that ran out.

The gate is latency-bound, not CPU-bound: `scripts/run-v2-tests.ts` spawns `bun test <file>` one
file at a time in a `for` loop.

## Decisions

- Each step gets its own deadline, sized to what that step does; the shared wall clock stops being the binding constraint. Rules out one number covering a seconds-long `lint:md` and a ~9-minute test step.
- Retain a total ceiling as a backstop, not the normal bound. Rules out an uncapped per-step model whose worst case is the sum of every step.
- Reuse the write loop's wall-plus-hard-ceiling shape (#2121) rather than inventing a second budget vocabulary.
- The flake-retry gets a fresh step budget. Rules out charging the retry to the first attempt's remainder, which is what made the observed failure deterministic.
- Per-step budgets must exceed the measured worst-case scope (`shared/**` → all three test slices) with real headroom.
- An exhausted budget names the step and the time it was allotted. Rules out a bare `deadline exceeded` with no attribution.
- Do not fix this by raising `JARVIS_READY_TIMEOUT_MS`. It is already honored and reachable from the daemon environment; a bigger single budget hides the problem. Rules out an env-only fix.
- Every budget kill — per-step and total-ceiling — still exits `124`, so the caller's timeout-vs-red-gate discrimination keeps working. Rules out a new per-step kill path that exits with a test-failure code.
- Out of scope: making the suite faster.

## Acceptance criteria

- [ ] A test asserts each step is bounded by its own budget: a step that overruns is killed while a later step still receives its full budget; the pre-fix shared wall clock fails it.
- [ ] A test asserts the flake-retry runs with a fresh step budget, not the first attempt's remainder.
- [ ] A test asserts the total ceiling still terminates a run whose per-step budgets would otherwise sum past it; removing the ceiling fails it.
- [ ] Deadline-exceeded output names the step that exhausted the budget and the time it was allotted.
- [ ] A test asserts both kill paths (per-step and total-ceiling) exit `124`.
- [ ] `bun run typecheck` and the test scripts matching the touched surfaces pass.

## Documentation updates

- `v2/docs/test-writing.md` — the per-step gate budget the aggregate suite must fit inside.

## Prerequisites

- `gate-timeout-is-not-a-red-gate` is merged: the implement run treats a `124` gate exit as retryable infrastructure failure. Same seam (`scripts/ready.ts` timeout handling) — plan and run this intent against that merged result.
