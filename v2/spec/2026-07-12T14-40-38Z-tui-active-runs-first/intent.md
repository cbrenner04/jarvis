---
name: tui-active-runs-first
---

# Put active runs first in the TUI monitor

Group selectable run rows by operator relevance so active work appears above terminal history. Keep queued runs in the existing queue section.

## Decisions

- Preserve daemon order within each group; rejected a second chronology policy that would make groups reorder unexpectedly.
- Classify by run status, not `isLive`; rejected treating a temporarily non-live active status as terminal history.

Update `v2/docs/first-workflow-walkthrough.md` with the ordering contract.

## Prerequisites
