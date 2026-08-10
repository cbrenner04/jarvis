# Reveal an attention target with Enter

## Problem

Tree-focus Enter is unbound, so a selected attention row cannot move selection to its underlying tree node.

## Decision ledger

- Bind unmodified tree-focus Enter on an attention row to select its `targetId` through the existing selection path. For a collapsed non-representative run member, materialize that target as its own painted tree row instead of selecting an invisible id or its group's representative. Rules out a separate navigation state and alias selection.
- Preserve `expandedPipelineNodeIds`; selected-ancestor expansion reveals the selected target and scroll follow brings its painted row into the viewport. Rules out converting implicit reveal into durable explicit expansion.
- Leave tree-focus Shift+Enter and Enter on every non-attention row inert. Rules out a second expansion or activation binding.
- Preserve command-focus Enter as command submission. Rules out routing editor Enter to tree activation.
- Add an Enter-reveal tree hint only for an attention selection. Rules out a permanently inapplicable hint.

## Tasks

- Expose attention-target activation through the monitor controls and bind unmodified tree-focus Enter through `openInkMonitor` without changing command-focus input routing.
- Select the target through normal state/scroll follow; for a collapsed non-representative run member, expose the target as a painted row while selected-ancestor expansion reveals it without changing explicit expansion state.
- Extend `v2/src/tui/tui-entry.test.tsx`, `v2/src/tui/tui-ink-monitor.test.tsx`, and dock-hint coverage with in-body mutation directives for binding, eligibility, selection, painted-target, scroll-follow, and hint guards.
- Update the attention navigation contract in `v2/docs/operator-runbook.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] In `v2/src/tui/tui-entry.test.tsx`, tree-focus Enter on an attention row selects its target, leaves `expandedPipelineNodeIds` unchanged, and produces a painted selected tree row inside the scroll-follow viewport with every required ancestor expanded.
- [ ] In `v2/src/tui/tui-entry.test.tsx`, Enter on attention targeting a collapsed non-representative run member selects that member and materializes its id as the painted selected row; its pipeline, branch when present, and stage ancestors are expanded without explicit expansion-state writes.
- [ ] In `v2/src/tui/tui-entry.test.tsx`, tree-focus Enter and Shift+Enter on a pipeline, branch, stage, run, or ad-hoc tree row leave selection and explicit expansion unchanged.
- [ ] `v2/src/tui/tui-ink-monitor.test.tsx` — `submits only focused command input` stays green.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` — `shows contextual command-focus hints without multiline editing` stays green.
- [ ] In `v2/src/tui/tui-entry.test.tsx`, tree hints advertise Enter reveal only while an attention row is selected.
- [ ] `v2/src/tui/tui-ink-monitor.test.tsx` — `tree-focus Enter activates only attention targets`; Keystone checkpoint: removing the unmodified tree-focus Enter binding makes the production input-route test fail against the pre-fix unbound behavior.
- [ ] `v2/src/tui/tui-entry.test.tsx` — `tree Enter reveals only an attention target`; Mutation checkpoint: inverting each added or modified attention-selection, target-materialization, ancestor, scroll-follow, or hint guard makes the scoped test fail, including invisible-target and unchanged-state negative cases.
- [ ] `v2/docs/operator-runbook.md` documents tree-focus Enter reveal and its contextual hint; `v2/docs/v1-behaviors.md` records the binding and preserved explicit expansion state.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — unmodified tree-focus Enter reveal, painted collapsed-member target, inert tree rows and Shift+Enter, and contextual hint.
- `v2/docs/v1-behaviors.md` § TUI / observability — attention-target Enter binding, painted collapsed-member target, and preserved explicit expansion state.
