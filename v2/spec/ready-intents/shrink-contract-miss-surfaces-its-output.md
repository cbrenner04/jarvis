---
name: shrink-contract-miss-surfaces-its-output
---

# A shrink contract miss surfaces the agent output that missed

## Problem

A shrink `contract_miss` records only the bare outcome kind and the failed contract id. `invalid_token`
and `missing_blocker` each emit a detail log event carrying the offending text
(`v2/src/execution/write-loop.ts`), but a `contract_miss` does not, so the operator cannot tell whether
the shrink contract/prompt is too strict or the agent simply misbehaved — the diagnosis needed to
attack the high shrink-miss rate.

## Decisions

- A `contract_miss` emits a detail log event carrying the failing invocation output alongside the failed contract id — rules out inferring the cause from the run row's outcome kind alone.
- Detail is emitted for every write-loop `contract_miss`, not only the shrink pass — rules out a shrink-special-cased log path.
- Output text is truncated the same way the existing detail events truncate — rules out unbounded log rows.

## Acceptance criteria

- [ ] A `contract_miss` terminal boundary emits a log event carrying the failing invocation output and the failed contract id, verified by a test.
- [ ] A shrink-pass `contract_miss` surfaces that detail against the hidden shrink run, verified by a test.
- [ ] The recorded output is truncated consistently with existing detail log events, verified by a test.

## Documentation updates

- `v2/docs/workflow-runner.md` — the `contract_miss` detail event in the shrink/write outcome record.
- `v2/docs/operator-runbook.md` — where to read shrink-miss output when diagnosing a miss.

## Prerequisites

- Same-seam sibling: `shrink-miss-after-completed-write-resumes-at-shrink` edits shrink `contract_miss` handling in the same area (`v2/src/execution/workflow-runner.ts`). Plan/run these two serially, each against the other's merged result — not fanned out in parallel.
