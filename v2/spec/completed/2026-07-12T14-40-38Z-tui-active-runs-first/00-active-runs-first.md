# 00 - Group selectable run rows active-first

The monitor's run table (`monitorTextLines` in `v2/src/tui/tui-monitor-lines.ts`) prints every
non-`queued` run in raw daemon order, so terminal history (`completed`, `failed`, `killed`,
`blocked`) can sit above the run the operator is actually steering. Split the selectable rows into
an active group and a terminal group, active first. Queued runs keep their existing FIFO `Queue`
section.

## Decisions

- Discriminator: terminal = the run reached an end state (operator ended it, or it finished/failed/blocked); active = the run is still steerable toward completion, waiting on the operator or the agent. Active: `in-progress`, `awaiting-human`, `revising`, `paused`, `budget-soft-stopped`. Terminal: `completed`, `failed`, `killed`, `blocked`. Rules out "resumable ⇒ active", which would drag `killed` into the active group.
- Do **not** reuse the daemon's `isTerminalRunStatus()` (`v2/src/daemon/daemon.ts:129`), which counts `paused` as terminal. The divergence is deliberate: the daemon's predicate answers "may I stop supervising?"; the TUI's answers "is the operator still steering?". Reusing it reintroduces the exact defect this spec fixes.
- Classify by `status`, never `isLive`; an active run that is momentarily not-live must not read as history.
- Exhaustive union over `RunStatus` (five active + four terminal + `queued` = all of `RUN_STATUSES`), so a future status is a typecheck failure, not a silent fallthrough.
- Stable partition: preserve daemon order within each group; rules out re-sorting by time or status, which would make rows shuffle between polls.
- Grouped order seeds only the *initial* selection. Existing anchor-by-`runId` behavior in `v2/src/tui/tui-entry.tsx` stands: a selected run that transitions to a terminal status keeps its `>` and slides into the terminal group. Rules out re-deriving selection from the grouped order each poll, which would yank selection mid-watch.
- Table render and default-selection derivation consume one shared ordering helper; rules out two parallel orderings that can drift.
- Grouping is display-only: no daemon/wire change, no new section heading, no group labels in the table.

## Acceptance criteria

- [x] The monitor run table lists active runs (`in-progress`, `awaiting-human`, `revising`, `paused`, `budget-soft-stopped`) above terminal runs (`completed`, `failed`, `killed`, `blocked`).
- [x] Within each group rows keep the daemon's list order.
- [x] An active-status run that is `not-live` still sorts into the active group.
- [x] Queued runs remain only in the `Queue` section, in FIFO order.
- [x] On entry with a terminal run first in daemon order, the selected (`>`) row is the topmost active run, and `wait` is issued for it.
- [x] A selected active run that transitions to a terminal status stays selected and moves with its row into the terminal group; selection is not reset to the top of the grouped order.
- [x] `v2/src/tui/tui-monitor-lines.test.ts` and `v2/src/tui/tui-entry.test.tsx` cover the grouping, the selection default, and selection persistence across an active→terminal transition.

## Documentation updates

- `v2/docs/first-workflow-walkthrough.md`: in the `jarvis tui` layout section, state the ordering contract as an operator sees it — active runs first (newest first), terminal history after (newest first), `Queue` unchanged in FIFO order — plus one sentence noting that when every run is terminal, selection falls to the first terminal row.
- `v2/docs/v1-behaviors.md`: update the run-table and selection-default entries with the new ordering contract (behavior change to existing TUI functionality).
