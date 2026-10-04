---
name: tui-row-navigation
---

# Navigate TUI run rows from the keyboard

Let the operator move selection through selectable run rows with up/down arrows and non-conflicting vi-style keys. Selection movement switches the outcome `wait` subscription to the new run. Refreshes keep selection valid as rows reorder or disappear.

## Decisions

- Keep `q`, `a`, `v`, `k`, and revise-compose semantics unchanged; rejected assigning navigation to an existing steering key.
- Exclude queued rows from navigation; rejected selecting rows that existing run controls cannot act on.
- Use `j` for down and arrows for both directions; rejected `k` for up because `k` remains kill.

Update `v2/docs/first-workflow-walkthrough.md` with navigation keys and selection behavior.

## Prerequisites

- Selecting a run replaces the selected run's `wait` subscription and outcome state.
