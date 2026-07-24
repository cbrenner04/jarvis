---
name: coverage-advisory-finishes-inside-write-step
---

# The coverage advisory finishes inside the write step

Three implement attempts delivered the uncovered-changed-line advisory as post-settle work. That
re-prompt reads and writes the run store after the write step's terminal boundary; callers close
the store on step completion, producing `RangeError: Cannot use a closed database` and (in workflow
runs) missing later-step run rows. `daemon-workflow-start.test.ts` regresses 25/0 → 24/1;
`daemon-run-failure-capture.test.ts` 11/0 → 9/2. Patching daemon tests to tolerate post-terminal
store access masks the ordering violation. Completes the undelivered half of
`write-step-reports-uncovered-changed-lines` (reporter-only on `main`).

## Decisions

- The advisory re-prompt runs and completes before the write step commits its terminal boundary; rules out post-settle or background delivery.
- The advisory is ordered inside the write step, not a separate workflow step with its own run row; rules out a new step type.
- The advisory consumes no iteration budget and cannot change the run outcome (`complete` stays `complete`); rules out counting it as a write iteration or altering terminal status.
- `daemon-workflow-start.test.ts` and `daemon-run-failure-capture.test.ts` stay unchanged from `main` (25/0, 11/0); rules out bumping attempt counts, flush budgets, or `store.isClosed()` guards as the fix.
- A regression test drives a completing write run with uncovered lines and asserts the advisory attempt precedes the terminal boundary and immediate store close causes no `Cannot use a closed database`; rules out re-introducing the race.
- A completing run with no uncovered changed lines issues no re-prompt and does not call the reporter; rules out unconditional advisory passes.
- Plan subspec ACs for ordering, iteration-budget, and no-op behavior each name a concrete test that fails pre-fix; rules out implicit new-behavior verification.

## Acceptance criteria

- [ ] With the advisory enabled, `daemon-workflow-start.test.ts` and `daemon-run-failure-capture.test.ts` pass unchanged from `main` (25/0 and 11/0).
- [ ] A completing write run with uncovered changed lines re-prompts the agent exactly once; the advisory attempt's store writes all precede the step's terminal boundary; a regression test fails against post-settle ordering.
- [ ] The advisory pass consumes no iteration budget and does not change the run's outcome or status.
- [ ] A completing run with no uncovered changed lines issues no re-prompt and no reporter call.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — the coverage advisory is ordered inside the write step, before the terminal boundary; it never touches the store after the step settles.

## Prerequisites

- The uncovered-changed-line reporter identifies uncovered production lines for the run-base diff.
- The write step commits a terminal boundary that callers treat as final and after which the run store may be closed.
