# 00 - Render selection detail

## Problem

The monitor right pane drops available pipeline, stage, and run diagnostics, loses pipeline ancestry below the pipeline row, and reads run outcome from selection-independent wait state.

## Decisions

- Build all content in pure `monitorRightPaneSegmentRows` output — rules out Ink-owned assembly.
- Prefix pipeline, stage, and attributed-run detail with one pipeline identity and ordered stage-roll-up block; omit it for unattributed runs — rules out lost or invented ancestry.
- Resolve run detail by selected run id and read only its `DaemonListRunRow` — rules out positional selection and `waitState` outcome bleed.
- Render stored epoch-millisecond timestamps plus existing wall-clock elapsed formatting — rules out locale-dependent timestamps or a second elapsed convention.
- Preserve exact right-pane branch keys, including `default` — rules out applying the left-tree blank-default presentation to diagnostics.
- Omit undefined optional run fields; render nullable and falsy pipeline/stage values with JSON semantics — rules out misleading placeholders and truthiness loss.
- Hard-wrap complete rendered rows to `layout.rightWidth` without ellipsis — rules out truncation or width-unbounded diagnostics.
- Keep spec path, agent/model binding, per-step timestamps, command dispatch, steering behavior, and pane scrolling unchanged — rules out unwired fields and adjacent TUI slices.

## Work

- Replace pipeline/stage stubs and wait-derived outcome rows in `v2/src/tui/tui-monitor-lines.ts` with selection-keyed pipeline context, stage detail, and run detail.
- Wrap right-pane rows within the computed right-pane width while preserving complete ids, paths, JSON diagnostics, and errors.
- Extend `v2/src/tui/tui-monitor-lines.test.ts` with complete pipeline, stage, attributed-run, unattributed-run, cross-run isolation, and hard-wrap pins.
- Align the durable TUI brief, operator runbook, and v1-parity catalog.

## Acceptance criteria

- [ ] Pipeline, stage, and attributed-run selections begin with the same pipeline block: full pipeline id, name, project, state, elapsed, creation/finish timestamps, terminal action, seed path, publication success/failure, and every stage in durable order with exact branch key, status, and elapsed.
- [ ] Stage selection then renders the selected durable stage's record id, stage id, exact branch key, authored position, status, workflow invocation id, artifact, failure detail, and start/end timestamps.
- [ ] Run selection renders only the selected row's full run id, project, branch, status, liveness, creation/finish timestamps, step id, workflow invocation id, every workflow step's id/role/status/terminal outcome/attempt count, loop outcome, iterations, resumability, error, review passes/behavior, worktree path, and PR number/URL; undefined optional fields are omitted.
- [ ] An unattributed run renders run detail without pipeline identity or stage roll-up.
- [ ] Every right-pane output row is at most `layout.rightWidth`; long ids, paths, serialized artifacts, and error text continue across rows without `…`, and rejoining wrapped fragments preserves the complete value.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` adds complete selection-detail regressions that fail against the baseline implementation and pass after the change; a non-selected row carries conflicting values for every run-detail field and the selected-row expectations exclude them.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` adds a long-value regression that fails against the baseline implementation and proves width-bounded, lossless, ellipsis-free wrapping.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` carries a `// @mutate` directive replacing the unique selected-id lookup in `v2/src/tui/tui-monitor-lines.ts` with positional run resolution; the conflicting-row pin turns red under the mutation.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` carries a `// @mutate` directive removing the unique `layout.rightWidth` bound in `v2/src/tui/tui-monitor-lines.ts`; the wrapping pin turns red under the mutation.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` carries source-mutation checkpoints for every other added or modified production guard; each guard inversion turns its positive or effect-suppression negative pin red, with no production invert hooks.
- [ ] Existing `v2/src/tui/tui-monitor-lines.test.ts` selection, off-pane resolution, workflow-collapse, and steering-feedback tests stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/spec/tui-overhaul-brief.md` — mark detail-pane selection content shipped and remove the stale missing-detail claim.
- `v2/docs/operator-runbook.md` § Observe — describe pipeline context plus selection-specific stage/run diagnostics and lossless wrapping.
- `v2/docs/v1-behaviors.md` — record the additive v2 selection-keyed detail behavior and selected-row outcome source.
