# 01 - Keyboard row navigation

`jarvis tui` selects the first selectable row on entry and never moves: `selectRun` exists on `TuiMonitorControls` but no key is bound to it, so the operator can only steer the run the monitor happened to pick. Add keyboard movement through the selectable rows.

## Decisions

- One shared selectable-rows-in-display-order helper feeds both `monitorTextLines` rendering and navigation; rejected re-deriving the non-queued filter in `tui-entry.tsx`, which lets the two orders drift (the pending `tui-active-runs-first` regrouping would make `j` walk an order the operator cannot see).
- Navigate over non-queued rows only; rejected including Queue rows, which no steering control can act on.
- Bind down to `j` and `downArrow`, up to `upArrow` only; rejected `k` for up, and rejected remapping kill off `k` to free it, because `k` is the established kill binding.
- The cursor is id-anchored: each keypress recomputes the selected run's position in the current row list and steps from there; rejected a stored index, which points at a different run after a refresh reorders rows.
- Clamp at both ends; rejected wrap-around, which silently jumps the operator across the whole table on a key repeat.
- With no selection, down/`j` selects the first selectable row and up selects the last; rejected leaving navigation dead after a refresh clears selection, which would strand the operator with no way back.
- Movement goes through the existing `setSelection` path (new `wait`, cleared outcome and steering feedback); rejected a display-only cursor decoupled from the `wait` subscription.
- Held movement keys fan out `wait` calls unbounded — each `setSelection` bumps the wait token and abandons stale responses client-side rather than cancelling them. Accept as-is; rejected debouncing movement and cancelling in-flight waits, unjustified before the fan-out is observed to hurt.
- Navigation keys are inert while a revise prompt is composing; rejected moving selection out from under an in-flight compose.
- `selectRun` stays on `TuiMonitorControls` — view-host tests drive selection through it; it is not dead code.
- The footer hint line advertises the navigation keys; rejected walkthrough-only documentation, which leaves keys discoverable only from a markdown file.

## Task checklist

- [ ] Extract the selectable-rows-in-display-order helper and use it for both rendering and navigation.
- [ ] Extend `TuiMonitorControls` with next/previous selection movement, implemented in `tui-entry.tsx`.
- [ ] Bind `downArrow`/`j` and `upArrow` in `tui-ink-monitor.tsx`, outside the composing branch.
- [ ] Extend the footer hint line with the navigation keys.
- [ ] Update the docs listed below.

## Acceptance criteria

- [ ] Pressing down (`downArrow` or `j`) moves selection to the next selectable row and up (`upArrow`) to the previous one, stepping in the order the run table renders (verified against the rendered rows, not a separately derived list).
- [ ] Navigation clamps: down on the last selectable row and up on the first leave selection unchanged.
- [ ] Queued rows are never selected by navigation, even when adjacent to a selectable row in `list` order.
- [ ] With no run selected, down selects the first selectable row and up selects the last; with no selectable rows, both keys are no-ops.
- [ ] Moving selection issues a daemon `wait` for the newly selected run, resets the Outcome panel to pending for it, and clears steering feedback.
- [ ] After a refresh reorders rows, the same run stays selected and the next movement key steps relative to that run's new position in the rendered order.
- [ ] Navigation keys do not move selection while a revise prompt is composing.
- [ ] The footer hint line names the navigation keys.
- [ ] The `tui-ink-monitor` binding tests from `00-keypress-seam.md` (`q`, `a`, `v`, `k`, revise-compose) stay green, as do `tui-entry.test.tsx` — including its clearing of selection when the selected run leaves the selectable set.

## Documentation updates

- `v2/docs/first-workflow-walkthrough.md`: navigation keys (arrows plus `j`), clamping, that navigation skips Queue rows, and that moving selection re-issues `wait` and resets the Outcome panel.
- `v2/docs/write-behavior.md`: drop the "keybindings are not wired yet" / "production keybindings deferred" claims; record that selection movement is bound and routes through the same `setSelection` path.
- `v2/docs/v2-architecture.md`: add the navigation keys to the bound-key vocabulary and the rationale (why `j` but not `k` for up).
- `v2/docs/v1-behaviors.md`: not applicable — v2-only surface, no v1 behavior changes.
