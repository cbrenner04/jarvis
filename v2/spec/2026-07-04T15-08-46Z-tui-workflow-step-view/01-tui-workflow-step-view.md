# 01 - TUI workflow step view

Render workflow-step progress in the monitor when the selected run is workflow-backed.

## Prerequisites

- Merged daemon workflow-step snapshot slice: `v2/spec/2026-07-04T15-08-46Z-tui-workflow-step-view/00-daemon-workflow-step-status-snapshot.md`.
- Merged TUI run monitor: `v2/spec/completed/2026-06-30T21-06-57Z-tui-run-monitor/01-tui-run-monitor-view.md`.

## Decisions

- The workflow-step view appears only when the selected daemon row carries workflow metadata; rules out replacing the single-step monitor for every run.
- Single-step runs keep the existing monitor behavior and chrome unchanged; rules out showing empty or placeholder workflow UI.
- The step view reads the selected row's latest daemon `list` snapshot; rules out blocking on `wait` for active-step state.
- The active step is visually distinguished and prior steps show terminal outcome plus attempt count; rules out hiding workflow progress until the run ends.
- Steps not yet started stay visible as pending for workflow-backed runs; rules out collapsing future steps.
- Refreshes update the selected run's step view in place; rules out reconnecting or forcing reselection when the active step advances.
- Selection change swaps step views with the selected row; rules out persisting stale workflow state across selection changes.
- Deferred to first consumer: exact glyphs, colors, and line wrapping for step statuses — pin when the ink component lands.
- Existing selected-run `wait` outcome panel behavior stays intact beside the new step view; rules out redefining `wait` semantics in this slice.

## Task checklist

- Extend TUI monitor state and rendering to carry optional workflow-step snapshots from daemon `list`.
- Render workflow-step progress for the selected workflow-backed run while preserving the current single-step monitor path.
- Update refresh handling so step-view changes follow selected-row `list` updates.
- Add co-located TUI tests covering workflow-backed and single-step rows.
- Update durable docs per Documentation updates.

## Acceptance criteria

- [ ] For a selected workflow-backed run, `jarvis tui` shows a workflow-step view that identifies the active step, prior steps' terminal outcomes, and per-step attempt counts from daemon `list`.
- [ ] For a selected single-step run, `jarvis tui` keeps the existing monitor view unchanged and renders no empty workflow-step chrome.
- [ ] When periodic `list` refresh advances the selected workflow run from one step to the next, the workflow-step view updates in place without reconnecting or changing selection.
- [ ] When a workflow run stops early on a non-complete step, `jarvis tui` shows that step's terminal outcome and leaves later steps pending.
- [ ] `v2/spec/completed/2026-06-30T21-06-57Z-tui-run-monitor/01-tui-run-monitor-view.md` wait-state and selection-change behaviors stay green.
- [ ] `v2/docs/write-behavior.md` documents that workflow-backed runs show per-step status from daemon `list`, while single-step runs keep the prior monitor view.
- [ ] `v2/docs/v2-architecture.md` cross-links the TUI workflow-step view to daemon run snapshots.
- [ ] `v2/docs/v1-behaviors.md` has a `[v2 additive]` entry for workflow-step view in `jarvis tui`.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — document workflow-step view activation, data source (`list`), and single-step fallback.
- `v2/docs/v2-architecture.md` — cross-link monitor workflow-step rendering to daemon run snapshots.
- `v2/docs/v1-behaviors.md` — add `[v2 additive]` workflow-step view note under TUI/observability.
