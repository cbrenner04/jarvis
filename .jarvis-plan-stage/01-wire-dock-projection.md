# 01 - Wire the dock projection

## Problem

Ink still owns hardcoded dock text and cannot paint the projected command state.

## Decisions

- `createMonitorDisplay` paints only the pure four-row projection through the existing segmented-row renderer — rules out retained Ink dock copy or a second projection.
- The TUI command boundary supplies the required machine profile and derives the displayed digest from the invoking keyed socket; discovery does not replace that identity.
- Production monitor state starts with empty buffer, cursor zero, tree focus, and no result/error; refresh and Ink session merges preserve those session fields — rules out resetting the dock on polls or rerenders.
- Both split and stacked shells keep `dockHeight: 4` and paint four children for empty and long input — rules out content-dependent terminal height.
- Existing tree controls remain unchanged; editing and submission stay in their dedicated follow-on slices.

## Work

- Thread invoking identity and initial dock state through `v2/src/commands/tui.ts`, `v2/src/tui/tui-entry.tsx`, and monitor session updates.
- Replace `renderDockContent` assembly in `v2/src/tui/tui-ink-monitor.tsx` with the pure projection.
- Add command-boundary, state-retention, and split/stacked Ink-tree regressions.
- Align the durable dock contract and current TUI brief.

## Acceptance criteria

- [ ] `v2/src/tui/tui-ink-monitor.test.tsx` adds a regression that fails against the hardcoded baseline and proves `createMonitorDisplay` paints the pure projection's four rows, including cursor, continuation, and contextual hints, in split and stacked shells.
- [ ] `v2/src/commands/tui.test.ts` and `v2/src/tui/tui-entry.test.tsx` prove production state receives the invoking machine profile/keyed-socket digest and retains all dock session fields across refresh and display updates.
- [ ] Empty and long input paint exactly four dock children and leave pane height unchanged in both layout modes; no dock text is assembled in `tui-ink-monitor.tsx` outside the pure projection.
- [ ] Existing unfocused navigation, expansion, divider, kill, and quit tests in `v2/src/tui/tui-ink-monitor.test.tsx` stay green.
- [ ] `v2/src/commands/tui.test.ts`, `v2/src/tui/tui-entry.test.tsx`, and `v2/src/tui/tui-ink-monitor.test.tsx` carry one valid `// @mutate` directive for every added or modified wiring guard they pin; inverting each real source condition turns its pin red, with no production inversion hook.
- [ ] `v2/docs/operator-runbook.md` § Observe documents the fixed status/input/continuation/hints rows, active-pipeline count, invocation identity, refresh label, result/error feedback, cursor windowing, and contextual hints.
- [ ] `v2/docs/v1-behaviors.md` records the state-driven four-line dock and its v2-only status/input behavior.
- [ ] `v2/spec/tui-overhaul-brief.md` no longer claims the continuation row collapses when empty and records the pure dock projection as shipped while editing and dispatch remain open.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — fixed rows, status fields, cursor windowing, and contextual hints.
- `v2/docs/v1-behaviors.md` — state-driven four-line dock.
- `v2/spec/tui-overhaul-brief.md` — fixed continuation row and slice status.
