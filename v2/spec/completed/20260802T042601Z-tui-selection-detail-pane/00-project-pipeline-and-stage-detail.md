# 00 - Project pipeline and stage detail

## Problem

The monitor right pane drops available pipeline and stage diagnostics and loses pipeline ancestry below the pipeline row.

## Decisions

- Build pipeline and stage content in pure `monitorRightPaneSegmentRows` output — rules out Ink-owned assembly.
- Prefix pipeline, stage, and attributed-run selections with one pipeline identity and ordered stage-roll-up block; omit it for unattributed runs — rules out lost or invented ancestry.
- The pipeline project is the single distinct `project` value among rows joined by that pipeline's stage invocation ids. Omit the project row when no joined row exists or joined rows conflict; never select an arbitrary row or render an empty project value.
- Render stored epoch-millisecond timestamps plus existing wall-clock elapsed formatting — rules out locale-dependent timestamps or a second elapsed convention.
- Preserve exact right-pane branch keys, including `default` — rules out applying the left-tree blank-default presentation to diagnostics.
- Stage artifacts and failures use stable JSON serialization; `undefined` fields are omitted, while `null`, `false`, `0`, and empty strings render distinctly and unchanged. Plain strings render unquoted; structured values render recursively key-sorted JSON.
- Keep run detail, wrapping, spec path, agent/model binding, per-step timestamps, command dispatch, steering behavior, and pane scrolling unchanged — rules out unwired fields and adjacent TUI slices.

## Work

- Replace pipeline/stage stubs in `v2/src/tui/tui-monitor-lines.ts` with selection-keyed pipeline context, ordered roll-up, and stage detail.
- Make pipeline-project derivation unambiguous before the pure renderer consumes it.
- Extend `v2/src/tui/tui-monitor-lines.test.ts` with pipeline, stage, and attributed-run context pins.

## Acceptance criteria

- [x] Pipeline, stage, and attributed-run selections begin with the same pipeline block: pipeline id, name, state, elapsed, creation/finish timestamps, terminal action, seed path, publication success/failure, and every durable-order stage's stage id, exact branch key, status, and elapsed. The block includes project only when all joined stage rows agree.
- [x] Stage selection follows that block with the selected durable stage's record id, stage id, exact branch key, authored position, status, workflow invocation id, artifact, failure detail, and start/end timestamps. `undefined` artifact/failure fields are omitted; `null`, `false`, `0`, and empty strings remain observable; plain strings are unquoted and structured values are recursively key-sorted JSON.
- [x] `v2/src/tui/tui-monitor-lines.test.ts` adds pipeline, stage, and attributed-run-context regressions that fail against the baseline implementation and pass after this slice, including absent and conflicting joined-project cases and two otherwise indistinguishable stage roll-up rows.
- [x] The production guard delta in this slice is limited to selection-kind dispatch and the unambiguous-project fallback. `v2/src/tui/tui-monitor-lines.test.ts` carries one `// @mutate` directive for each unique guard target; the pipeline/stage and missing-or-conflicting-project pins turn red under their respective mutations, with no production invert hooks.

## Documentation updates

- None in this slice; final documentation follows the complete renderer in 02.
