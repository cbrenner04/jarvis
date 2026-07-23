# The coverage advisory must finish inside the write step, not as post-settle work

## Problem

The reporter that computes uncovered changed lines shipped (#2013). Delivering it to the agent — the
actual point of `write-step-reports-uncovered-changed-lines` — needs a write-step re-prompt, and
three implement attempts all placed that re-prompt as work that runs **after** the write step
settles its terminal boundary. It reads and writes the run store as background work, so when a caller
closes the store on that step's completion, the advisory throws `RangeError: Cannot use a closed
database` and, in the workflow path, the next step's run row is never recorded.

Deterministic regression, verified 2026-07-23 across two review-off runs (#2018, #2019) and one
review-on run:

- On `main` (no advisory): `v2/src/daemon/daemon-workflow-start.test.ts` 25/0,
  `v2/src/daemon/daemon-run-failure-capture.test.ts` 11/0.
- With the advisory: `daemon-workflow-start.test.ts` 24/1 (`kill/pause reject a later step's runId
  once onStepRunCreated has tracked it` — `step2Run` never appears; store closed underneath it),
  `daemon-run-failure-capture.test.ts` 9/2 (both `Cannot use a closed database` during the failed
  step's terminal recording).

`#2018`'s repair loop tried to absorb this in the tests — inject reporter seams, bump
`throwOnNthRecordAttemptStart(…, 2→3)` for the extra attempt, raise `flushBackgroundRuns(5→20)`,
guard one daemon path with `store.isClosed()` — and still could not get green. That is the tell: the
advisory adds an attempt and store access *after* the step's terminal state, which the whole
workflow harness treats as final. Patching each daemon test to tolerate a post-terminal store write
masks an ordering violation rather than fixing it.

## Decisions

- The advisory re-prompt runs and completes **before** the write step commits its terminal boundary;
  no store read or write happens after the step settles. Rules out running it as background/post-settle
  work, which is what all three attempts did.
- The advisory still consumes no iteration budget and still cannot change the run's outcome
  (`complete` stays `complete`); it is ordered inside the step, not a new step. Rules out modeling it
  as a separate workflow step with its own run row.
- The daemon workflow/failure-capture tests are **not** modified to tolerate post-terminal store
  access; they must stay as they are on `main` (25/0, 11/0). Rules out bumping their attempt counts
  or flush budgets as the fix.
- A regression test drives a completing write run with uncovered lines and asserts the advisory
  attempt is recorded *before* the terminal boundary, and that closing the store immediately after
  the step settles causes no `Cannot use a closed database`. Rules out re-introducing the race.

## Acceptance criteria

- [ ] With the advisory enabled, `v2/src/daemon/daemon-workflow-start.test.ts` and
      `v2/src/daemon/daemon-run-failure-capture.test.ts` pass unchanged from `main` (25/0 and 11/0),
      proving no post-terminal store access.
- [ ] A completing write run with uncovered changed lines re-prompts the agent exactly once, and the
      re-prompt's store writes all precede the step's terminal boundary; a test fails against a
      post-settle ordering.
- [ ] The advisory pass consumes no iteration budget and does not change the run's outcome or status.
- [ ] A completing run with no uncovered changed lines issues no re-prompt and no reporter call.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — the coverage advisory is ordered inside the write step, before the
  terminal boundary; it never touches the store after the step settles.

## Prerequisites

- The uncovered-changed-line reporter exists (`v2/src/execution/uncovered-changed-lines.ts`, #2013).
- The write step commits a terminal boundary that callers treat as final and after which the run
  store may be closed.
