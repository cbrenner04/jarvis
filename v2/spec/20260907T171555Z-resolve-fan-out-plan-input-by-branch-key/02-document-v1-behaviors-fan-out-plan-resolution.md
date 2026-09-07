# Document v1-behaviors fan-out plan resolution

## Problem

`v2/docs/v1-behaviors.md` does not record the v2 fan-out plan-resolution behavior change from whole-list verification to branch-key-scoped downstream-input selection.

## Prerequisites

- `00-branch-scoped-fan-out-plan-resolution` (document landed behavior only).

## Decision ledger

- Tag fan-out plan downstream-input resolution `[v2 behavior change]`; branch-scoped lanes no longer whole-list-verify sibling inputs before dispatch; rules out `[v2 additive]`, which would understate the replaced resolver behavior.

## Tasks

- Update `v2/docs/v1-behaviors.md` with a `[v2 behavior change]` entry describing branch-scoped fan-out plan downstream-input selection, consumed-input satisfaction on initial default-row whole-list walks, and lane-scoped refusal semantics.

## Acceptance criteria

- [ ] `v2/docs/v1-behaviors.md` records the changed v2 fan-out plan-resolution behavior under `[v2 behavior change]`.

## Documentation updates

- None beyond the acceptance criterion above.
