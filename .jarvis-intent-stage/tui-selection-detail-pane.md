---
name: tui-selection-detail-pane
---

# TUI selection detail pane

Render complete, selection-keyed pipeline, stage, and run detail in the right pane from polled monitor state.

## Problem

The right pane omits available diagnostics, loses pipeline context below the pipeline row, and can show outcome state for a different run.

## Decisions

- Assemble detail as pure `monitorRightPaneSegmentRows` output — rules out untestable content assembly inside ink components.
- Render the pipeline identity and stage roll-up above pipeline, stage, and attributed-run detail; render unattributed runs without that block — rules out losing ancestry or inventing pipeline ownership.
- Derive run outcome and diagnostics from the selected `DaemonListRunRow`, never `waitState` — rules out cross-run outcome bleed.
- Render every available selection field, including stage artifacts/failures and run workflow, worktree, outcome, error, review, and PR data — rules out retaining a grep-dependent stub.
- Wrap long ids, paths, serialized artifacts, and error text to `layout.rightWidth` without ellipsis — rules out detail-pane truncation.
- Keep run spec path, agent/model binding, per-step timestamps, command dispatch, steering, and pane scrolling out of scope — rules out adding fields absent from current wires or absorbing later TUI behaviors.

## Acceptance criteria

- [ ] Pipeline, stage, and attributed-run selections render the same pipeline identity block first, including full identity, state/timing, terminal action, seed path, publication outcome, and every stage's branch/status/elapsed roll-up.
- [ ] Stage selection additionally renders record id, stage id, branch, position, status, workflow invocation, artifact, failure detail, and start/end timestamps.
- [ ] Run selection renders the selected row's full id, project, branch, status/liveness/timing, step/workflow data, loop outcome, iterations, resumability, error, review fields, worktree, and PR fields plus the full workflow-step list.
- [ ] An unattributed run renders only run detail, with no pipeline identity block.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` uses a non-selected run with conflicting values to prove every run detail value comes from the selected row and fails against the baseline behavior.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` proves a value wider than `layout.rightWidth` wraps across rows with no `…` and fails against the baseline behavior.
- [ ] Each mutation-checkpoint criterion names a pinning test carrying a matching `// @mutate <path> "<old>" -> "<new>"` directive.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/spec/tui-overhaul-brief.md` — mark the detail-pane behavior shipped.
- `v2/docs/operator-runbook.md` § Observe — describe right-pane content by selection kind.
- `v2/docs/v1-behaviors.md` — record the additive v2 detail-pane behavior.

## Prerequisites

- `pipeline_list` exposes pipeline terminal action, admission seed path, terminal publication success time, and terminal publication failure.
- `pipeline_list` exposes each stage record's id, authored position, artifact, and failure detail without changing stage order.
- Daemon `list` rows expose the selected run's identity, lifecycle, workflow, outcome, error, review, worktree, and PR fields.
- The monitor tree resolves pipeline, stage, attributed-run, and unattributed-run selections from the full flattened tree.
- Shell layout exposes the right-pane width for pure row rendering.
