# Document operator-runbook chained resolution

## Problem

`operator-runbook.md` documents external admission for standalone intent and plan entry, git-disabled chained implement, and fan-out approval/resume semantics, but not chained intent→plan handoff when ready-intents land only in the external home, or operator-visible notification when one fan-out lane fails while siblings continue.

## Prerequisites

- `00-external-ready-intent-chained-resolution` and `01-fan-out-lane-failure-incidents` (document landed behavior only).

## Decision ledger

- State in `operator-runbook.md` that opted-in pipelines chain intent→plan through externally landed `ready-intents/<name>.md` without requiring those files on the prior git branch, honoring inverted `effectivePublishGit` (project `plan.commit`, then machine `modes.plan.commit`); rules out implying external ready-intents must be committed to the intent worktree for chained plan dispatch.
- Document that notification derivation surfaces failed fan-out lanes by `branchKey` while the pipeline remains non-terminal; cross-link `daemon-host.md` for derivation detail; rules out duplicating incident schema in the runbook.

## Tasks

- Update `v2/docs/operator-runbook.md` configured-pipeline / external-spec sections: chained intent→plan handoff for external ready-intents on opted-in projects.
- Update `v2/docs/operator-runbook.md` operator-notification section: fan-out lane `stage-failed` incidents name `branchKey` while sibling lanes keep the pipeline live.

## Acceptance criteria

- [x] `v2/docs/operator-runbook.md` documents chained intent→plan handoff for external ready-intents on opted-in projects and fan-out lane failure incidents naming `branchKey`, consistent with `00`–`01`.

## Documentation updates

- None beyond the acceptance criterion above.
