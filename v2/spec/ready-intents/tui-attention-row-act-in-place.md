---
name: tui-attention-row-act-in-place
---

# Act on a pinned attention row without leaving it

## Problem

With the segment pinned, clearing a gate still means walking the tree: `approve`/`reject` resolve their target by scanning tree stage nodes for the selected node id, so an attention-row selection refuses. Nothing moves the operator from a pin to the underlying node either — `Enter` is unbound in tree focus. The pinned list surfaces work it cannot act on.

## Decisions

- `approve`/`reject` with an attention gate row selected dispatch the same daemon call with the same pipeline/stage/branch params as approving that gate's tree node. Rules out a new verb — command-grammar changes are a phase non-goal.
- A selected non-gate attention row refuses `approve`/`reject` with the existing `not_awaiting_stage` code. Rules out a silent no-op.
- `Enter` in tree focus reveals a selected attention row's target: selection moves to the target node, whose ancestors expand through the existing selected-ancestor expansion. Rules out writing the expansion set directly.
- `Enter` in tree focus with any non-attention row selected does nothing.
- `Enter` under command focus still submits the buffer. Rules out stealing the dock's submit key.
- Tree hints advertise reveal only while an attention row is selected, matching how expansion and kill hints already appear conditionally.

## Acceptance criteria

- [ ] `approve` with an attention gate row selected issues `pipeline_approve` with the same params as approving that gate's tree stage node; a `tui-entry.test.tsx` test fails against the pre-fix code, which refuses the selection.
- [ ] `reject` with an attention gate row selected issues `pipeline_reject` the same way.
- [ ] `approve` with a failure attention row selected reports `not_awaiting_stage` and issues no RPC.
- [ ] `Enter` in tree focus with an attention row selected moves selection to the target node and paints that node in the tree with its ancestors expanded; a `tui-entry.test.tsx` test fails against the pre-fix code.
- [ ] `Enter` in tree focus with a tree row selected leaves selection and expansion unchanged.
- [ ] `Enter` under command focus still submits the command buffer (`tui-ink-monitor.test.tsx` submit tests stay green).
- [ ] The tree hint line advertises reveal only when an attention row is selected.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe and § Dock commands — `approve`/`reject` act on a selected attention gate row, failure rows refuse with `not_awaiting_stage`, and `Enter` reveals a pin's target node in the tree.
- `v2/docs/v1-behaviors.md` § TUI / observability — record the widened `approve`/`reject` selection sources and the new tree-focus `Enter` binding alongside the existing command-focus submit.

## Prerequisites

- A pinned attention segment renders above the work tree, and its rows lead the selectable order carrying a kind and a target node id.
- Selecting an attention row renders the target node's right-pane detail.
- The dock status line reports `N running · N awaiting gate · N failed · N done` over pipelines and ad-hoc items.
- `approve`/`reject` resolve an awaiting stage target from the current selection and dispatch it through the pipeline's owning daemon client.
- Ineligible `approve`/`reject` selections report a typed code, `not_awaiting_stage` among them, without contacting the daemon.
- Selecting a stage or run node expands its ancestors in the tree without writing the expanded-node set.
- The monitor exposes a control to change selection to a given node id, and tree-focus key handling is separate from command-focus key handling.
