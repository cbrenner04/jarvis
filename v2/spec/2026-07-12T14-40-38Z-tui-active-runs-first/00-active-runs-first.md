# 00 - Group selectable run rows active-first

The monitor's run table (`monitorTextLines` in `v2/src/tui/tui-monitor-lines.ts`) prints every
non-`queued` run in raw daemon order, so terminal history (`completed`, `failed`, `killed`,
`blocked`) can sit above the run the operator is actually steering. Split the selectable rows into
an active group and a terminal group, active first. Queued runs keep their existing FIFO `Queue`
section.

## Decisions

- Active statuses: `in-progress`, `awaiting-human`, `revising`, `paused`, `budget-soft-stopped`; terminal: `completed`, `failed`, `killed`, `blocked` — a resumable/steerable run is active even when idle, so `paused` and `budget-soft-stopped` do not sink into history.
- Classify by `status`, never `isLive`; an active run that is momentarily not-live must not read as history.
- Stable partition: preserve daemon order within each group; rules out re-sorting by time or status, which would make rows shuffle between polls.
- Default selection (`firstRunId` in `v2/src/tui/tui-entry.tsx`) picks the first row in the same grouped order the table renders, so "first selectable row is selected" stays true; rules out leaving selection on raw daemon order and marking a row that is not the top row.
- Grouping is display-only: no daemon/wire change, no new section heading, no group labels in the table.

## Acceptance criteria

- [ ] The monitor run table lists active runs (`in-progress`, `awaiting-human`, `revising`, `paused`, `budget-soft-stopped`) above terminal runs (`completed`, `failed`, `killed`, `blocked`).
- [ ] Within each group rows keep the daemon's list order.
- [ ] An active-status run that is `not-live` still sorts into the active group.
- [ ] Queued runs remain only in the `Queue` section, in FIFO order.
- [ ] On entry with a terminal run first in daemon order, the selected (`>`) row is the topmost active run, and `wait` is issued for it.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` and `v2/src/tui/tui-entry.test.tsx` cover the grouping and the selection default.

## Documentation updates

- `v2/docs/first-workflow-walkthrough.md`: state the run-table ordering contract (active statuses first, terminal history after, daemon order preserved within each group) in the `jarvis tui` layout section.
