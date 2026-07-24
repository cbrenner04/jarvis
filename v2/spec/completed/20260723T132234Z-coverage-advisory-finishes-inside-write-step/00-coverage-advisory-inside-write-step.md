# 00 - Coverage advisory inside the write step

## Problem

`reportUncoveredChangedLines` exists on `main` but nothing delivers it. Three implement attempts
wired the advisory as post-settle work after `executeWriteLoop` returns, so the re-prompt touched
the run store after the step's terminal boundary while callers (`workflow-runner`, daemon settle)
close the store — `RangeError: Cannot use a closed database`, missing later-step run rows, and
`daemon-workflow-start.test.ts` / `daemon-run-failure-capture.test.ts` regressions (25/0 → 24/1,
11/0 → 9/2).

## Decisions

- Run the advisory in the same write-loop iteration after a completing `executeWrite` and before
  `commitCompletionBoundary` for that attempt — rules out post-`executeWriteLoop` hooks in
  workflow-runner or daemon settle paths (the prior failure mode).
- Scope to implement write iterations (`patch.prompt.body`) that classify `complete` — rules out
  shrink, plan-draft, intent-split, and non-`complete` terminal outcomes.
- Deferred to first consumer: standalone `write.execute` advisory — pin when a caller needs it.
- Exactly one advisory re-prompt when the reporter returns uncovered sites — rules out zero-pass
  delivery and multi-pass loops.
- Advisory re-prompt is deliver-only: log the agent reply but do not re-run completion contracts or
  reclassify the step — rules out letting the advisory reply change `complete` to `blocked` /
  `contract_miss` / `progress`.
- Advisory does not increment `iterationsConsumed` — rules out counting it as a write iteration.
- Terminal `runStatus` / `outcomeKind` stay whatever `complete` already committed — rules out
  advisory-side status mutation.
- Call `reportUncoveredChangedLines` only after contracts pass and only when about to deliver;
  skip the reporter entirely when the run would not advisory — rules out unconditional coverage
  subprocesses on every completion.
- Re-prompt body is a registry artifact (`write.coverage-advisory`, listed in `prompts/registry.txt`)
  carrying the reporter's rendered text — rules out ad-hoc prompt strings in the loop.
- `daemon-workflow-start.test.ts` and `daemon-run-failure-capture.test.ts` stay unchanged from
  `main` — rules out bumping attempt counts, flush budgets, or `store.isClosed()` guards as the fix.

## Acceptance criteria

- [x] `v2/src/daemon/daemon-workflow-start.test.ts` stays green (25/0 on `main`).
- [x] `v2/src/daemon/daemon-run-failure-capture.test.ts` stays green (11/0 on `main`).
- [x] A new case in `v2/src/execution/write-loop.test.ts` drives a completing implement write with
      injected uncovered sites, asserts exactly one advisory re-prompt, asserts all advisory store
      writes (including invocation telemetry) precede the attempt's terminal `boundary_committed`,
      and closing the store immediately after the loop returns causes no `Cannot use a closed database`;
      it fails when advisory runs after the terminal boundary (post-settle ordering).
- [x] A new case in `v2/src/execution/write-loop.test.ts` proves `iterationsConsumed` is unchanged
      when the advisory fires on an otherwise one-iteration `complete`; it fails when the advisory
      increments the iteration counter.
- [x] A new case in `v2/src/execution/write-loop.test.ts` proves a completing implement write with
      no uncovered changed lines issues no advisory re-prompt and does not call
      `reportUncoveredChangedLines`; it fails when either guard is inverted.
- [x] Tests fail when each added guard is inverted: the no-uncovered-lines skip guard must call the
      reporter when inverted; the implement-only scope guard must run advisory on a non-implement
      prompt when inverted; the pre-boundary ordering guard must place advisory store writes after
      `boundary_committed` when inverted.
- [x] A test asserts the rendered `write.coverage-advisory` body: it carries the reporter's report
      text at the `COVERAGE_REPORT` placeholder and states the advisory is deliver-only. Mutating the
      prompt artifact's content fails it — the mutation verifier flips registry artifacts, and a
      prompt whose body nothing asserts is uncovered.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — coverage advisory delivery: ordered inside the implement write step,
  before the terminal boundary; deliver-only (no outcome change, no iteration budget); skipped when
  no uncovered sites; never touches the store after the step settles.
- `v2/docs/prompts.md` — `write.coverage-advisory` registry entry.
- `v2/docs/v1-behaviors.md` — **[v2 additive]** implement write completion may issue one
  uncovered-changed-line advisory re-prompt before the terminal boundary.
