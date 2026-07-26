---
name: shrink-miss-is-diagnosable-and-resumable
---

# A shrink miss surfaces its output and resumes at shrink

Combines `shrink-contract-miss-surfaces-its-output` and
`shrink-miss-after-completed-write-resumes-at-shrink` (merged 2026-07-26). Both edited shrink
`contract_miss` handling in the same block of `v2/src/execution/workflow-runner.ts` and each named
the other as a same-seam sibling requiring serial planning. One change removes that constraint, and
the two halves are complementary: without the detail event you cannot tell *why* a miss happened;
without resumability you pay a full write step to find out.

## Problem

The hidden shrink pass after an `implement` write step fails often — observed on roughly half of
implement runs on 2026-07-20, every one of which succeeded on a plain re-run, so the misses are
agent variance rather than defects in the change under test. Two things make that variance
expensive:

- **It is not diagnosable.** A `contract_miss` records only the bare outcome kind and the failed
  contract id. `invalid_token` and `missing_blocker` each emit a detail log event carrying the
  offending text (`v2/src/execution/write-loop.ts`); `contract_miss` does not. So an operator
  cannot tell whether the shrink contract is too strict or the agent misbehaved — exactly the
  diagnosis needed to attack the miss rate.
- **It is not recoverable.** A shrink `contract_miss`, and a shrink `blocked` carrying no
  `## Blocker` text, settle the workflow terminal. The implement write is already committed
  (#1836), but the run is non-resumable, so recovery re-runs the whole write step and re-spends its
  tokens. Only shrink `invocation_failure` with `failureKind: "error"` is resumable today.

## Decisions

- A `contract_miss` emits a detail log event carrying the failing invocation output alongside the
  failed contract id. Rules out inferring the cause from the run row's outcome kind alone.
- Detail is emitted for every write-loop `contract_miss`, not only the shrink pass. Rules out a
  shrink-special-cased log path.
- Output text is truncated the same way existing detail events truncate. Rules out unbounded log rows.
- A shrink `contract_miss` after a committed implement write settles resumable (`paused`), not
  terminal. Rules out discarding completed implementation work over a flaky shrink outcome.
- A shrink `blocked` whose blocker text is absent (`missing_blocker`) settles resumable on the same
  path. Rules out treating a text-less block as operator-actionable when there is nothing to read.
- Resume re-enters at the shrink pass and continues to publication; it does not re-run the completed
  implement write.
- A shrink `blocked` that *does* carry blocker text stays terminal. Rules out auto-retrying a genuine
  agent-reported blocker.
- Deferred to first consumer: whether the shrink pass bound-retries internally before surfacing a
  miss. Pin when the resumable path proves insufficient in practice.

## Acceptance criteria

- [ ] A `contract_miss` terminal boundary emits a log event carrying the failing invocation output
      and the failed contract id, verified by a test.
- [ ] A shrink-pass `contract_miss` surfaces that detail against the hidden shrink run, verified by
      a test.
- [ ] The recorded output is truncated consistently with existing detail log events, verified by a
      test.
- [ ] A shrink `contract_miss` after a completed implement write leaves the run resumable, verified
      by a test.
- [ ] Resuming that run retries shrink (or advances to publication) without re-running the implement
      write step, verified by a test asserting zero write-step agent invocations on resume.
- [ ] A text-less shrink `blocked` after a completed write is likewise resumable, verified by a test.
- [ ] A shrink `blocked` with blocker text remains terminal, verified by a test.
- [ ] Inverting the resumability predicate turns the resumable-`contract_miss` test RED.

## Documentation updates

- `v2/docs/workflow-runner.md` — the `contract_miss` detail event, and shrink `contract_miss` /
  text-less `blocked` recovery semantics.
- `v2/docs/operator-runbook.md` — where to read shrink-miss output when diagnosing a miss; replace
  the "re-run from scratch on a shrink strand" workaround with resume.

## Prerequisites

- The completed implement write output is committed before the hidden shrink pass runs.
- A shrink `invocation_failure` with `failureKind: "error"` already settles resumable, and resume
  skips the completed write.

## Out of scope

`missing_blocker` detection on the **write** path. Observed 2026-07-26: an implement run settled
`missing_blocker` even though the agent had appended a `## Blocker` section to the active subspec
(uncommitted, in a run with zero commits). That is write-loop blocker detection, a different seam
from shrink resumability, and it should not be folded in here.
