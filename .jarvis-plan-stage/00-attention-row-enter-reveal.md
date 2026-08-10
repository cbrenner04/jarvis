# 00 - Tree-focus Enter reveals the selected attention row's target

## Problem

An attention row surfaces an incident but cannot move selection to the tree node it names. `AttentionRow.targetId` already exists and `selectNode` already reveals an off-viewport tree row (expanding the selected node's ancestors via `resolveSelectedAncestors` and reclamping scroll-follow), but tree-focus Enter is unbound in `tui-ink-monitor.tsx` — the key handler falls through `:`/`/`/`q`/`k`/`j`/`e`/`[`/`]` with no `key.return` branch — so the operator has no way to get from the pinned incident to its row in the work tree.

Scope is targets already present in the full-flatten selectable set. The collapsed non-representative run-member case is the `tui-tree-reveal-collapsed-workflow-member` seed's work.

## Decisions

- Reveal is a new `TuiMonitorControls` method that resolves the selected attention row and routes `row.targetId` through the existing `selectNode` path — rules out a separate navigation state, an alias selection that keeps the attention id selected, or key-handler-side attention resolution in `tui-ink-monitor.tsx`.
- The reveal is a no-op when the selection is not an attention row, and inherits `selectNode`'s selectable-id guard when the target is absent from the selectable set — rules out inventing feedback or a forced expansion for the deferred collapsed-member case.
- Preserve stored `expandedPipelineNodeIds` and rely on selected-ancestor expansion plus scroll-follow — rules out converting the implicit reveal into durable explicit expansion.
- Bind unmodified `key.return` in tree focus only; leave tree-focus Shift+Enter inert and leave the command-focus `key.return` submit branch untouched — rules out a second activation binding or stealing the dock editor key.
- Advertise the reveal in the dock hint line (`dockHintLine`) only while the selection resolves to an attention row — rules out a permanently inapplicable hint.
- The keystone pins the reveal control in `tui-entry.test.tsx`; the Enter-binding guard checkpoint lives in `tui-ink-monitor.test.tsx` — `tui-entry.test.tsx` drives a fake `TuiViewHost` and never renders the ink input hook, so a directive on the key binding cannot turn a `tui-entry.test.tsx` assertion red.

## Task checklist

- [ ] Add the reveal method to `TuiMonitorControls` (`tui-monitor-types.ts`) and implement it in `tui-entry.tsx` over `selectedAttentionRow` + the existing `selectNode` path.
- [ ] Bind unmodified tree-focus `key.return` in `tui-ink-monitor.tsx` to the reveal control.
- [ ] Add the attention-selection-only reveal hint to `dockHintLine` in `tui-monitor-lines.ts`.
- [ ] Add the pinning tests and their `// @mutate` directives.
- [ ] Update `v2/docs/operator-runbook.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] With an attention row selected whose target sits under a collapsed pipeline ancestor and outside the painted viewport, the reveal control leaves `selectedNodeId` equal to the row's `targetId`, leaves stored `expandedPipelineNodeIds` byte-identical to its prior value, and paints the target id among the left-pane tree row ids; a new `tui-entry.test.tsx` test fails against the pre-fix code (no such control exists). `tui-entry.test.tsx` — `Enter reveal selects the attention row's target inside the painted viewport`; Keystone checkpoint: a `// @mutate` directive on the reveal method's dispatch line in `v2/src/tui/tui-entry.tsx` neutering it to a no-op turns this test red.
- [ ] Tree-focus unmodified Enter invokes the reveal control exactly once and tree-focus Shift+Enter invokes nothing; a new `tui-ink-monitor.test.tsx` test fails against the pre-fix unbound key. `v2/src/tui/tui-ink-monitor.test.tsx` — `tree-focus Enter drives the attention reveal control and Shift+Enter is inert`; Mutation checkpoint: a `// @mutate` directive inverting the `!key.shift` term of the tree-focus return guard in `v2/src/tui/tui-ink-monitor.tsx` turns this test red.
- [ ] The dock hint line advertises the Enter reveal while an attention row is selected and omits it for a null selection and for pipeline, branch, stage, run, and ad-hoc tree selections; a new `tui-monitor-lines.test.ts` test fails against the pre-fix hint line. `tui-monitor-lines.test.ts` — `dock hints advertise Enter reveal only for an attention-row selection`; Mutation checkpoint: a `// @mutate` directive forcing the hint's attention-selection condition true in `v2/src/tui/tui-monitor-lines.ts` turns this test red.
- [ ] Tree-focus Enter and Shift+Enter on a pipeline, branch, stage, run, or ad-hoc tree row leave `selectedNodeId` and `expandedPipelineNodeIds` unchanged: `tui-ink-monitor.test.tsx` `keeps command state unchanged in tree focus` and `submits only focused command input` stay green (command-focus Enter still submits).
- [ ] Selecting an attention row itself still keeps its own id selected and writes no scroll offset or explicit expansion: existing `tui-entry.test.tsx` attention-selection coverage stays green (behavior unchanged by the added control).
- [ ] Every added or modified guard — the reveal method's attention-row resolution, the tree-focus `key.return && !key.shift` binding, and the hint's attention-selection condition — has a pinning test that goes red when that guard is inverted; the hint condition's negative case asserts the reveal hint is absent for non-attention selections.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — tree-focus Enter on a selected attention row moves selection to the row's target, expanding ancestors implicitly and scroll-following, without writing stored explicit expansion; targets outside the selectable set are a no-op.
- `v2/docs/operator-runbook.md` § Dock commands — the contextual `Enter reveal` hint appears only for an attention-row selection; command-focus Enter still submits.
- `v2/docs/v1-behaviors.md` § TUI / observability — record the attention-target Enter binding, the reveal control on `TuiMonitorControls`, preserved `expandedPipelineNodeIds`, and the selection-conditional hint (amends the existing attention-selection entry that states selecting an attention row writes no expansion).
