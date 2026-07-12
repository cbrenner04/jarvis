# 00 - Keyboard row navigation

Today `jarvis tui` selects the first selectable row on entry and never moves: `selectRun` exists on `TuiMonitorControls` but no key is bound to it, so the operator can only steer the run the monitor happened to pick. Add keyboard movement through the selectable rows.

## Decisions

- Navigate over non-queued rows only, in run-table display order; rejected including the Queue rows, which no steering control can act on.
- Bind down to `j` and `downArrow`, up to `upArrow` only; rejected `k` for up because `k` is kill.
- Clamp at both ends; rejected wrap-around, which silently jumps the operator across the whole table on a key repeat.
- With no selection, down/`j` selects the first selectable row and up selects the last; rejected leaving navigation dead after a refresh clears selection, which would strand the operator with no way back.
- Movement goes through the existing `setSelection` path (new `wait`, cleared outcome and steering feedback); rejected a display-only cursor decoupled from the `wait` subscription.
- Navigation keys are inert while a revise prompt is composing; rejected moving selection out from under an in-flight compose.

## Task checklist

- [ ] Extend `TuiMonitorControls` with next/previous selection movement.
- [ ] Bind `downArrow`/`j` and `upArrow` in `tui-ink-monitor.tsx`, outside the composing branch.
- [ ] Implement movement in `tui-entry.tsx` over the selectable-row list.
- [ ] Update the walkthrough doc.

## Acceptance criteria

- [ ] Pressing down (`downArrow` or `j`) moves selection to the next non-queued row in run-table order; pressing up (`upArrow`) moves to the previous one.
- [ ] `k` still kills the selected run and `q`, `a`, `v`, and revise-compose behavior are unchanged (`tui-ink-monitor` and `tui-entry` steering tests stay green).
- [ ] Navigation clamps: down on the last selectable row and up on the first leave selection unchanged.
- [ ] Queued rows are never selected by navigation, even when adjacent to a selectable row in `list` order.
- [ ] With no run selected, down selects the first selectable row and up selects the last; with no selectable rows, both keys are no-ops.
- [ ] Moving selection issues a daemon `wait` for the newly selected run, resets the Outcome panel to pending for it, and clears steering feedback.
- [ ] Navigation keys do not move selection while a revise prompt is composing.
- [ ] A refresh that reorders rows keeps the same run selected; the existing `tui-entry.test.tsx` behavior of clearing selection when the selected run leaves the selectable set stays green.

## Documentation updates

- `v2/docs/first-workflow-walkthrough.md`: document the navigation keys (arrows plus `j`), clamping, that navigation skips Queue rows, and that moving selection re-issues `wait` and resets the Outcome panel.
