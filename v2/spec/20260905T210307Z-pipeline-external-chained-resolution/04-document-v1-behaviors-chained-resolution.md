# Document v1-behaviors chained resolution

## Problem

`v1-behaviors.md` records v2 external admission and chained external-plan implement but not external ready-intent chained resolution or non-terminal fan-out lane failure incidents.

## Prerequisites

- `00-external-ready-intent-chained-resolution` and `01-fan-out-lane-failure-incidents` (document landed behavior only).

## Decision ledger

- Add `[v2 additive]` bullets for external ready-intent chained resolution (inverted `effectivePublishGit` gate) and fan-out lane `stage-failed` incidents; rules out changing v1 pipeline or notification behavior.

## Tasks

- Update `v2/docs/v1-behaviors.md` with `[v2 additive]` entries for chained external ready-intent downstream-input resolution and stage-scoped `stage-failed` incidents carrying `branchKey` on non-terminal fan-out pipelines.

## Acceptance criteria

- [ ] `v2/docs/v1-behaviors.md` records v2 external chained ready-intent resolution and fan-out lane failure incident behavior without altering v1.

## Documentation updates

- None beyond the acceptance criterion above.
