# Document pipeline-execution fan-out plan resolution

## Problem

`v2/docs/pipeline-execution.md` documents fan-out lanes and `branchKeyFromDownstreamInput` but not branch-scoped downstream-input selection, consumed-input satisfaction during whole-list verification, or lane-scoped refusal semantics for plan resolution.

## Prerequisites

- `00-branch-scoped-fan-out-plan-resolution` (document landed behavior only).

## Decision ledger

- Record branch-scoped plan resolution, consumed-input satisfaction, and refusal semantics under the existing Fan-out lanes section; rules out duplicating the full resolver walkthrough in `daemon-host.md`.

## Tasks

- Update `v2/docs/pipeline-execution.md` Fan-out lanes prose to state that branch-scoped plan resolution selects the sole downstream input whose derived branch key equals the active lane and returns single-path `{ steps }`, that initial default-row whole-list verification treats consumed sibling inputs as satisfied, and that unmatched lane-to-input requests refuse with the lane and available inputs named without misdirecting intent re-drive after a succeeded intent stage.

## Acceptance criteria

- [x] `v2/docs/pipeline-execution.md` documents branch-scoped downstream-input selection, consumed-input satisfaction, and refusal semantics for fan-out plan resolution.

## Documentation updates

- None beyond the acceptance criterion above.
