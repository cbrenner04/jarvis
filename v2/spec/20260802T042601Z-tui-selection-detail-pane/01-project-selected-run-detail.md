# 01 - Project selected-run detail

## Problem

The right pane can show `waitState` outcome values for a run other than the selected run and omits durable selected-run diagnostics.

## Decisions

- This slice follows 00, which supplies the attributed pipeline context.
- Resolve the selected run once by selected run id from `state.runs`; every run diagnostic comes exclusively from that `DaemonListRunRow` — rules out positional resolution and cross-run bleed.
- Render run id, project, branch, status, liveness, creation/finish timestamps, step id, workflow invocation and steps, loop outcome, iterations, resumability, error, review, worktree, and PR data. Omit only `undefined`; preserve `null`, `false`, `0`, and empty strings. Plain strings are unquoted; structured error values use recursively key-sorted JSON.
- Remove `waitState` pending, ready, and error rows from right-pane detail. `waitState` is not a diagnostic source; existing auxiliary steering feedback remains after run detail.
- Attributed runs retain the 00 pipeline block; unattributed runs render only selected-run detail.
- Keep wrapping, spec path, agent/model binding, per-step timestamps, command dispatch, and pane scrolling unchanged.

## Work

- Replace wait-derived outcome rows in `v2/src/tui/tui-monitor-lines.ts` with selected-row diagnostics.
- Extend `v2/src/tui/tui-monitor-lines.test.ts` with attributed and unattributed selected-run regressions and cross-run isolation.

## Acceptance criteria

- [ ] A selected run renders its full run id, project, branch, status, liveness, creation/finish timestamps, step id, workflow invocation id, every workflow step's id/role/status/terminal outcome/attempt count, loop outcome, iterations, resumability, error, review passes/behavior, worktree path, and PR number/URL when present; `undefined` fields are absent and other falsy or null values remain distinguishable.
- [ ] An unattributed run renders only that selected run's detail, without the pipeline identity or stage roll-up; an attributed run retains the preceding 00 pipeline block.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` adds selected-run regressions that fail against the 00 baseline and pass after this slice: every listed field conflicts on a non-selected row, `waitState` conflicts on status/outcome/iterations/resumability, and neither conflicting source appears in the selected detail. The regression also pins retained steering feedback and absent wait-state rows.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` carries `// @mutate v2/src/tui/tui-monitor-lines.ts "state.runs.find((run) => run.runId === selectedRunId)" -> "state.runs[0]"`; the conflicting-row pin turns red under the mutation.
- [ ] The production guard delta in this slice is limited to selected-run existence, optional-field omission, and the no-`waitState` detail branch. `v2/src/tui/tui-monitor-lines.test.ts` carries a uniquely targeted `// @mutate` directive for each; its selected-run, omission, and wait-feedback pins turn red, with no production invert hooks.
- [ ] Existing `v2/src/tui/tui-monitor-lines.test.ts` selection, off-pane resolution, workflow-collapse, and steering-feedback tests stay green.

## Documentation updates

- None in this slice; final documentation follows the complete renderer in 02.
