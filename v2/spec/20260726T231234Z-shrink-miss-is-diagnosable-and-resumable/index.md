# Shrink miss is diagnosable and resumable at shrink

repo: cbrenner04/jarvis

Shrink `contract_miss` after a committed implement write is common agent-variance
failure. Today the `~shrink` row is non-resumable, `committedResult` replays the
miss without a fresh shrink invocation, and operator guidance points at
`inspect_spec` instead of resume — while the implement work is already committed.

- [ ] [00 - Write-loop contract_miss detail log event](./00-contract-miss-detail-log-event.md)
- [ ] [01 - Post-commit shrink contract_miss resume at shrink](./01-shrink-miss-resumes-at-shrink.md)

Land **00 before 01** when both ship in one PR so operator-runbook shrink-miss
diagnosis (`contract_miss_detail` on `implement~shrink`) is accurate. Subspec 01
code does not depend on 00's log event.

## Prerequisites

- The completed implement write output is committed before the hidden shrink pass runs.
- A shrink `invocation_failure` with `failureKind: "error"` already settles resumable,
  and resume skips the completed implement write.

## Out of scope

`missing_blocker` detection on the implement **write** path (see intent).
