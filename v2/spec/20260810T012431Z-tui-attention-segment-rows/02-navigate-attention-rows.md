# Navigate attention rows and resolve target detail

## Problem

Painted attention rows are not selectable or connected to the existing detail and input-control behavior.

## Decision ledger

- Prefix selectable order with all six capped attention ids, then every full-flatten tree id; never include the overflow row. Rules out navigation landing on a summary or dropping off-pane tree nodes.
- Resolve an attention selection only in the existing right-pane detail projection by mapping its attention id to the target id, then resolving that target against the complete joined model rather than painted or expanded tree rows. An attributed run therefore resolves when its pipeline or stage ancestors are collapsed, and an ad-hoc group target resolves even when the failed run is not its representative. Rules out a separate attention detail schema or collapsed-ancestor detail loss.
- Keep the attention id in monitor state; pass the original selection to left-pane derivation. Selection may trigger established selection effects such as clearing steering feedback, but it must not write stored `leftPaneTreeScrollOffset` or explicit `expandedPipelineNodeIds`. Rules out implicit reveal/movement while not promising unchanged effective tree expansion.
- Keep approve/reject dispatch and Enter-to-reveal deferred to `tui-attention-row-act-in-place`. Rules out widening the interaction surface in this change.

## Prerequisites

- `00-build-attention-row-projection.md` supplies capped attention ids and target node ids.
- `01-render-pinned-attention-segment.md` supplies the painted attention segment and constrained left-pane layout.

## Task checklist

- Prefix `monitorSelectableNodeIds` with capped attention ids and exclude overflow.
- Alias attention selection to its target only in the existing right-pane projection, using a complete joined-model target lookup that is independent of collapsed ancestors and representative-row choice.
- Add focused `v2/src/tui/tui-monitor-lines.test.ts` coverage for selectable order, overflow exclusion, target detail, collapsed attributed runs, and non-representative ad-hoc failures.
- Add `v2/src/tui/tui-entry.test.tsx` coverage through entry controls for selecting an attention id, retaining that id, preserving stored scroll/explicit expansion, and clearing established steering feedback.
- Add in-body `// @mutate` directives for selectable prefix, overflow exclusion, target aliasing, complete-model lookup, stored-state preservation, and selection side-effect guards.
- Update durable operator, parity, and command-center status documentation.

## Acceptance criteria

- [x] `tui-monitor-lines.test.ts` test `attention selection resolves target detail beyond collapsed ancestors` fails against the pre-fix code and proves an attention id remains selected while the existing target detail renders for an attributed run behind collapsed ancestors and a non-representative failed ad-hoc member.
- [x] Attention ids precede every full-flatten tree id in `monitorSelectableNodeIds`; all capped attention rows remain ordered before tree ids even when clipped, and the overflow row is never selectable.
- [x] Selecting an attention row resolves the target node's existing right-pane detail from the complete joined model while monitor state retains its attention id.
- [x] `tui-entry.test.tsx` proves the entry-control seam preserves stored `leftPaneTreeScrollOffset` and explicit `expandedPipelineNodeIds` when it selects an attention id, while applying the established steering-feedback clearing side effect; it does not assert identical effective tree rendering.
- [x] `tui-monitor-lines.test.ts` — `attention selection resolves target detail beyond collapsed ancestors`; Mutation checkpoint: in-body `// @mutate` directives invert selectable-prefix, overflow exclusion, attention-target aliasing, and complete-model target lookup guards, and each turns the scoped test red.
- [x] `tui-entry.test.tsx` — `selecting attention preserves stored tree navigation state`; Mutation checkpoint: in-body `// @mutate` directives write the stored scroll offset or explicit expansion during attention selection, or suppress steering-feedback clearing, and each turns the scoped test red.
- [x] `v2/docs/operator-runbook.md` § Observe documents sources, glyphs, row anatomy, six-row cap, incident total/overflow count, gate-first and oldest-first ordering, undated rows, empty state, Queue order, constrained-pane clipping, selectable order, and target-detail reuse.
- [x] `v2/docs/v1-behaviors.md` § TUI / observability records separately namespaced attention selection ids, selectable order, collapsed-target detail resolution, and target-node detail reuse.
- [x] `v2/spec/tui-command-center-brief.md` records attention segment rows as shipped without marking deferred act-in-place behavior complete.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — attention sources, glyphs, anatomy, cap, ordering, timestamps, empty state, Queue order, clipping, selectable order, and target detail.
- `v2/docs/v1-behaviors.md` § TUI / observability — attention selection ids, selectable order, collapsed-target detail resolution, and target-node detail reuse.
- `v2/spec/tui-command-center-brief.md` — mark segment-row delivery only; retain deferred interaction work.
