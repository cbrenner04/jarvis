# 01 - Project durable debate rows into list and TUI

## Problem

Daemon workflow snapshots currently render review-debate status only from an in-memory progress map. Once subspec 00 gives the step a durable row, list and TUI must retain its authored identity and terminal result after live progress disappears without losing the current role-level view during execution.

## Prerequisite

- Subspec 00 provides durable review-debate rows and terminal lifecycle statuses.

## Decisions

- Use live review progress for the active role and the durable row for lifecycle and quiescent status; rules out replacing adversary/advocate/adjudicator/actuator visibility with a coarse row status.
- Identify the row by the authored `stepId` from its workflow snapshot; rules out deriving a label from the current debate role or preset name.
- Render the review as its own list/TUI run row alongside the plan draft row; rules out folding review status only into the entry-row workflow rollup.
- Retain terminal debate rows under existing run-retention policy; rules out an in-memory-only terminal projection that disappears on daemon restart.

## Task checklist

- Merge live role progress with durable review-debate row state in daemon workflow snapshots.
- Ensure daemon list returns the distinct debate row before, during, and after terminal settlement and restart.
- Render the durable row and its workflow-step state through the existing TUI monitor.
- Add daemon-list and TUI regressions for plan draft plus debate review.
- Update the durable operator and parity docs listed below.

## Acceptance criteria

- [x] A plan workflow with debate review appears in `jarvis run list` as distinct durable draft and review rows, with the review row identified by its authored `stepId`.
- [x] While debate is active, list/TUI report the review row `in-progress` and retain the current adversary, advocate, adjudicator, or actuator progress.
- [x] After success, failure, or daemon-reconciled interruption, list/TUI retain the review row as `completed`, `failed`, or `interrupted` respectively without requiring live progress memory.
- [x] After daemon restart, the terminal review row and its authored workflow-step snapshot remain queryable.
- [x] `v2/src/daemon/daemon-start-list.test.ts` adds a plan-plus-debate regression covering live role progress and durable terminal/restart projection that fails against the baseline.
- [x] `v2/src/tui/tui-monitor-lines.test.ts` covers distinct draft/review rows and the debate row's completed, failed, and interrupted tones/status text.
- [x] Existing non-durable light-review projection tests stay green in `v2/src/daemon/daemon-start-list.test.ts`.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — durable debate-review rows in list/TUI, including live roles and retained terminal statuses.
- `v2/docs/v1-behaviors.md` — changed v2 workflow observability for durable debate review rows.
