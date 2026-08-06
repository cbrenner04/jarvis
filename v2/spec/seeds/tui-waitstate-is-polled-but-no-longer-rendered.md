---
name: tui-waitstate-is-polled-but-no-longer-rendered
---

# The TUI still polls `wait` for state nothing renders

## Problem

Slice 4 (#2521) moved run detail onto the selected `DaemonListRunRow` and deleted `outcomeLines`, so `waitState` has no reader left in the renderer. The producer side is untouched: `buildWaitStateForSelection` still runs and `waitState` still lives on `TuiMonitorState` (`v2/src/tui/tui-entry.tsx:66,188,195,207,241,415`; `v2/src/tui/tui-monitor-types.ts:21`).

That is a live `wait` RPC per selection change, on the operator's daemon, feeding a field with zero consumers — cost and a boundary-blocking call for nothing.

A second, smaller widening landed in the same slice and is worth deciding rather than inheriting: right-pane run resolution now falls back to `monitorSelectableRuns(state)` (`v2/src/tui/tui-monitor-lines.ts:464`), which does **not** apply the terminal-retention window the left pane uses. A run filtered out of the left pane — or hidden under a collapsed pipeline — now renders full detail on the right, while `monitorSelectableNodeIds` still cannot navigate to it. So selection and detail resolution disagree about which runs exist.

## Decisions

- Remove `waitState`, `buildWaitStateForSelection`, and the selection-driven `wait` RPC from the
  TUI entry and monitor state — rules out keeping a polled field alive "in case slice 5 wants it";
  slice 5 can add back a consumer-shaped call if it needs one.
- Steering feedback (`state.steeringFeedback`) is unaffected — rules out reading this as a cut to
  operator feedback.
- Resolve the retention disagreement by **windowing** the right-pane fallback to the same set
  `monitorSelectableNodeIds` walks, so a row the operator cannot select cannot render detail —
  rules out two notions of "which runs exist" in one pane pair.
- Out of scope: the left pane's retention rule itself, and right-pane vertical scrolling.

## Acceptance criteria

- [ ] `jarvis tui` issues no `wait` RPC on selection change; a test drives a selection change
      against a fake daemon client and asserts zero `wait` calls.
- [ ] `waitState` and `buildWaitStateForSelection` are gone from `tui-entry.tsx` and
      `tui-monitor-types.ts`; `bun run typecheck` proves no reader remains.
- [ ] Steering feedback still renders after run detail; a regression covers it.
- [ ] A run outside the left pane's retention window renders `No run selected.`-equivalent detail
      rather than full run detail; a regression fails against the current fallback.
- [ ] Mutation checkpoint: reverting the right-pane fallback to the unwindowed run list turns that
      regression RED, via a `// @mutate` directive in the pinning file.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — the right pane resolves detail from the same run set the
  operator can select.

## Prerequisites

- `buildWaitStateForSelection`, `TuiMonitorState.waitState` (`v2/src/tui/tui-entry.tsx`,
  `v2/src/tui/tui-monitor-types.ts`)
- `monitorSelectableRuns`, `monitorSelectableNodeIds` (`v2/src/tui/tui-monitor-lines.ts`)
