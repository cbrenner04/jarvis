# The shrink step contract-misses often and strands the run terminally

## Problem

The hidden shrink pass that runs after an `implement` write step **fails frequently**, and when it
does the run settles terminal/non-resumable, discarding the completed implementation and forcing a
full re-run (re-spending write tokens and agent time).

Observed 2026-07-20 across the P0+P1 session — roughly **half** of implement runs failed at shrink:

- `shrink-invocation-error-preserves-write-work` (claude): shrink `contract_miss`, `resumable:false`.
- `blocked-outcome-carries-blocker-text` (claude): shrink `contract_miss` on the first attempt.
- `test-daemons-die-with-their-test-runner` (claude): shrink `blocked` / `agent_blocked` with **no
  `## Blocker` text** written (a text-less block, itself a defect the blocker-text work targets).
- Several shrink runs also rode >10 min with the daemon deaf, no new log events, before settling.

Every one recovered on a plain re-run (often on a different agent), which indicates the failures are
flaky/agent-variance in satisfying the shrink contract, not a defect in the underlying change.

`shrink-invocation-error-preserves-write-work` (#1836) commits write output before shrink and makes a
shrink **`invocation_error`** resumable — but a shrink **`contract_miss`** (and a text-less `blocked`)
still settles terminal, so the completed write is still thrown away.

## Decisions

- A shrink `contract_miss` (and a text-less shrink `blocked`) on a run whose write step already
  completed is **resumable/retryable**, not terminal: resume retries the shrink pass (or advances
  past it to publication) without re-running the write step. Rules out discarding completed
  implementation work over a flaky shrink outcome. Builds on the pre-shrink commit from #1836.
- Investigate the high shrink-miss rate itself: whether the shrink contract/prompt is too strict, and
  whether the shrink pass should bound-retry internally before surfacing a miss. Capture the shrink
  invocation output on a miss (ties into the swallowed-gate-error observability gap).

## Acceptance criteria

- [ ] A shrink `contract_miss` after a completed implement write settles resumable (not terminal
      `stop`); resume finishes shrink (or advances to publication) without re-running the write step,
      verified by a test.
- [ ] A text-less shrink `blocked` after a completed write is likewise recoverable (not a terminal
      strand that discards the write).
- [ ] The shrink miss surfaces its invocation output for diagnosis (log event / run row), not only a
      bare `contract_miss`.

## Documentation updates

- `v2/docs/workflow-runner.md` — shrink `contract_miss` / text-less `blocked` recovery semantics.
- `v2/docs/operator-runbook.md` — replace the "re-run from scratch on a shrink strand" workaround.

## Notes

Sibling of [[shrink-step-invocation-error-strands-write-work]] (shipped #1836, invocation_error path).
This seed is the `contract_miss` / text-less-`blocked` path plus the underlying miss-rate.
