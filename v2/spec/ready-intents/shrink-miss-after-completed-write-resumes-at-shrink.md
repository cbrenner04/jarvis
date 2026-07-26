---
name: shrink-miss-after-completed-write-resumes-at-shrink
---

# A shrink contract-miss or text-less block after a completed write resumes at shrink

## Problem

The hidden shrink pass after an `implement` write step settles the workflow terminal on a
`contract_miss` and on a `blocked` outcome carrying no `## Blocker` text. The completed implement
write is already committed (#1836), but the run is non-resumable, so recovery means re-running the
whole write step and re-spending write tokens. Observed ~half of implement runs on 2026-07-20; every
one succeeded on a plain re-run, so the misses are agent variance, not defects in the change.

Only shrink `invocation_failure` with `failureKind: "error"` is resumable today
(`v2/src/execution/workflow-runner.ts`, the post-implement shrink block).

## Decisions

- A shrink `contract_miss` after a committed implement write settles resumable (`paused`), not terminal — rules out discarding completed implementation work over a flaky shrink outcome.
- A shrink `blocked` whose blocker text is absent (`missing_blocker`) settles resumable on the same path — rules out treating a text-less block as an operator-actionable blocker when there is nothing for the operator to read.
- Resume re-enters at the shrink pass and continues to publication; it does not re-run the completed implement write.
- A shrink `blocked` that *does* carry blocker text stays terminal — rules out auto-retrying a genuine agent-reported blocker.
- Deferred to first consumer: whether the shrink pass bound-retries internally before surfacing a miss — pin when the resumable path proves insufficient in practice.

## Acceptance criteria

- [ ] A shrink `contract_miss` after a completed implement write leaves the run resumable, verified by a test.
- [ ] Resuming that run retries shrink (or advances to publication) without re-running the implement write step, verified by a test.
- [ ] A text-less shrink `blocked` after a completed write is likewise resumable, verified by a test.
- [ ] A shrink `blocked` with blocker text remains terminal, verified by a test.

## Documentation updates

- `v2/docs/workflow-runner.md` — shrink `contract_miss` / text-less `blocked` recovery semantics.
- `v2/docs/operator-runbook.md` — replace the "re-run from scratch on a shrink strand" workaround with resume.

## Prerequisites

- The completed implement write output is committed before the hidden shrink pass runs.
- A shrink `invocation_failure` with `failureKind: "error"` already settles resumable and resume skips the completed write.
- Same-seam sibling: `shrink-contract-miss-surfaces-its-output` also edits shrink `contract_miss` handling. Plan/run these two serially, each against the other's merged result — not fanned out in parallel.
