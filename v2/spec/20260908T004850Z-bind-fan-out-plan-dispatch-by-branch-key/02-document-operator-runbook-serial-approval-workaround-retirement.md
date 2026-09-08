# Document operator-runbook serial-approval workaround retirement

## Problem

`v2/docs/operator-runbook.md` operational-caveats bullet `Approve every fan-out gate before any sibling plan lands (2026-09-07)` mixes resolver whole-list verification, serial gate approval, and hand-driving later lanes as a workaround for sibling ready-intent consumption blocking plan dispatch — guidance this spec retires for the consumption-blocking failure shape while preserving verified simultaneous-approval guidance.

## Prerequisites

- `00-branch-key-fan-out-plan-result-binding` (behavior landed).

## Decision ledger

- Revise the `:898` bullet to drop serial-approval and hand-drive-later-lanes workaround prose for sibling ready-intent consumption blocking dispatch; keep simultaneous back-to-back gate approval guidance; rules out deleting the whole bullet and losing valid simultaneous-approval operator guidance.

## Tasks

- Edit `v2/docs/operator-runbook.md` operational-caveats bullet `Approve every fan-out gate before any sibling plan lands (2026-09-07)`: remove serial gate approval, whole-list verification failure from consumed siblings, and hand-drive-later-lanes fallback as workarounds for dispatch blocking; retain approving all fan-out `approve-intent` gates back to back before any plan consumes input dispatches every lane in parallel.

## Acceptance criteria

- [ ] `v2/docs/operator-runbook.md` no longer documents serial fan-out gate approval or hand-driving later lanes as a workaround for sibling ready-intent consumption blocking plan dispatch, and still documents simultaneous back-to-back fan-out gate approval.

## Documentation updates

- None beyond the acceptance criterion above.
