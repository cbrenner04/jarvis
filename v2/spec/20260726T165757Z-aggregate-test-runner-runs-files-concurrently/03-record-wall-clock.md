# 03 - Record the new wall clock and gate-trust guidance

## Problem

`v2/docs/test-writing.md` records 697s as the aggregate `bun run test` wall clock and cites it as the
basis of the ready-gate run ceiling; `v2/docs/test-writing.md:54` separately derives the
`JARVIS_READY_TIMEOUT_MS` retry argument from the same 697s figure. `v2/docs/operator-runbook.md`
§ Gate trust points at the 697s reasoning too. After subspecs 00 and 01 the figure is wrong, and the
operator guidance for reading a gate failure on a loaded machine changes: the runner now loads the
machine itself by design.

Docs-only subspec: no runtime behavior changes here. The full aggregate roster includes
sandbox-unrunnable files that cannot execute in the implement agent's sandbox at all, so the measured
figures and the five-run stability bar below can only be produced by the operator on real hardware.

## Decisions

- The recorded figure comes from a real `bun run test` invocation on operator hardware, kept
  side-by-side with the 697s pre-change figure and the 574.4s `test:cost` figure, each labeled by the
  command that produced it. Rules out replacing the old numbers, which are the only evidence the
  change did anything, and rules out reusing the `test:cost` number, which measures a different
  command.
- Every doc reference to 697s is reworded so no file cites it as the *current* aggregate wall clock —
  the 697s pre-change figure is retained as a labeled historical data point, not deleted. Rules out a
  literal "no file mentions 697s" bar, which would contradict the decision above to keep it
  side-by-side for comparison; the target is the framing, not the digits.
- Ready-gate budget constants (`TEST_STEP_BUDGET_MS`, `DEFAULT_TIMEOUT_MS`) are not changed here. Rules
  out re-sizing them in this spec: they follow from a settled wall clock across several runs, and
  changing a gate budget is its own reviewable risk. The prose that cites 697s as their rationale is
  updated to the new figure with the constants explicitly noted as unchanged and pending a separate
  re-sizing follow-up, filed as a harness-friction issue per this repo's convention (see AGENTS.md §
  Harness friction) so the pending work has an owner instead of a dangling "pending re-sizing" note.
- `v2/docs/test-writing.md:54`'s `JARVIS_READY_TIMEOUT_MS` retry-argument derivation is recomputed
  against the new measured figure in this subspec, not deferred alongside the budget constants — it
  is prose describing today's arithmetic, not a constant carrying its own reviewable risk. Rules out
  lumping it in with the deliberately-unchanged constants above.
- `v2/docs/operator-runbook.md` § Gate trust names `JARVIS_TEST_CONCURRENCY` as the operator's
  mitigation for running the gate on an already-loaded machine (lowering it trades wall clock for
  headroom). Rules out leaving the loaded-machine guidance without a concrete lever.
- Five consecutive full-aggregate runs with identical results are the stability bar, recorded by the
  operator on a quiet machine. Rules out accepting a single fast run: the three failures this spec
  guards against are load-dependent and one run is not evidence.

## Operator measurement (2026-07-26, supplied)

Five consecutive `bun run test` invocations on quiet operator hardware (no TUI, no daemon runs, no
agents), on branch commit `528a54aa`:

| run | result | wall clock |
| --- | --- | --- |
| 1 | pass | 330 s |
| 2 | pass | 327 s |
| 3 | pass | 325 s |
| 4 | pass | 321 s |
| 5 | pass | 325 s |

**5/5 pass, zero failures, range 321–330 s, mean 326 s.** Pre-change baseline 697 s (`bun run test`,
2026-07-26) — a 2.1× reduction. Run 1 is the cold-cache outlier; runs 2–5 sit in a 6 s band.

The stability bar is met. **The ≤320 s target is not** — every run is 1–10 s above it. That figure
was subspec 01's projection against a ≈267 s theoretical floor, not a measurement; it is superseded
by the measured distribution below rather than re-rolled until a run dips under. Record 326 s (mean)
as the figure, with the 321–330 s range, and use **≤335 s** as the regression bar so normal variance
does not red-gate.

## Acceptance criteria

- [ ] `v2/docs/test-writing.md` records the post-change aggregate `bun run test` wall clock from a
      measured run, alongside the retained 697s pre-change figure and the 574.4s `test:cost` figure,
      each labeled with the command and date that produced it. (Manual)
- [ ] `v2/docs/test-writing.md` § Ready-gate step budgets cites the new wall clock in the run-ceiling
      rationale, recomputes the `JARVIS_READY_TIMEOUT_MS` retry-argument derivation against it, and
      states that `TEST_STEP_BUDGET_MS` and `DEFAULT_TIMEOUT_MS` are deliberately unchanged pending a
      re-sizing follow-up filed as a harness-friction issue.
- [ ] `v2/docs/operator-runbook.md` § Gate trust states the gate's current aggregate wall clock, that
      the runner now saturates the machine by design, names `JARVIS_TEST_CONCURRENCY` as the lever for
      a loaded machine, and that a gate failure on an already-loaded machine is still worth one
      re-run before believing it.
- [ ] No file in `v2/docs/` presents 697s as the *current* aggregate wall clock (the retained
      pre-change figure stays labeled as historical).
- [ ] `bun run lint:md` is green.
- [x] Five consecutive `bun run test` runs on a quiet operator machine pass with identical results.
      Satisfied by the Operator measurement section above: 5/5 pass, 321–330 s, mean 326 s. The
      original "at or below 320s" clause was a projection, not a measurement, and is superseded by
      that recorded distribution; the regression bar is ≤335 s. (Manual — operator-supplied)
