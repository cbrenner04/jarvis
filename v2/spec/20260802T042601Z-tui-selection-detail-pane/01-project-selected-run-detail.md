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
- Removing the `waitState` rows invalidates two assertions in `v2/src/tui/tui-ink-monitor.test.tsx` — one requires the removed `Outcome`/`runStatus` panel, the other requires a selected durable run to vanish when filtered from the left pane. Updating those two assertions to the new contract is in scope; deleting or weakening any other assertion in that file is not.

## Work

- Replace wait-derived outcome rows in `v2/src/tui/tui-monitor-lines.ts` with selected-row diagnostics.
- Extend `v2/src/tui/tui-monitor-lines.test.ts` with attributed and unattributed selected-run regressions and cross-run isolation.
- Update the two invalidated `v2/src/tui/tui-ink-monitor.test.tsx` assertions to the new contract.

## Acceptance criteria

- [x] A selected run renders its full run id, project, branch, status, liveness, creation/finish timestamps, step id, workflow invocation id, every workflow step's id/role/status/terminal outcome/attempt count, loop outcome, iterations, resumability, error, review passes/behavior, worktree path, and PR number/URL when present; `undefined` fields are absent and other falsy or null values remain distinguishable.
- [x] An unattributed run renders only that selected run's detail, without the pipeline identity or stage roll-up; an attributed run retains the preceding 00 pipeline block.
- [x] `v2/src/tui/tui-monitor-lines.test.ts` adds selected-run regressions that fail against the 00 baseline and pass after this slice: every listed field conflicts on a non-selected row, `waitState` conflicts on status/outcome/iterations/resumability, and neither conflicting source appears in the selected detail. The regression also pins retained steering feedback and absent wait-state rows.
- [x] `v2/src/tui/tui-monitor-lines.test.ts` carries `// @mutate v2/src/tui/tui-monitor-lines.ts "state.runs.find((run) => run.runId === selectedRunId)" -> "state.runs[0]"`; the conflicting-row pin turns red under the mutation.
- [x] The production guard delta in this slice is limited to selected-run existence, optional-field omission, and the no-`waitState` detail branch. `v2/src/tui/tui-monitor-lines.test.ts` carries a uniquely targeted `// @mutate` directive for each; its selected-run, omission, and wait-feedback pins turn red, with no production invert hooks.
- [x] Existing `v2/src/tui/tui-monitor-lines.test.ts` selection, off-pane resolution, workflow-collapse, and steering-feedback tests stay green.
- [x] `v2/src/tui/tui-ink-monitor.test.tsx` passes with only its two invalidated assertions rewritten to the new contract; every other assertion in that file is unchanged.

## Documentation updates

- None in this slice; final documentation follows the complete renderer in 02.
