---
name: tui-attention-row-act-in-place
---

# Act on a pinned attention row without leaving it

## Problem

Pinned rows surface work but existing `approve` and `reject` resolve only selected tree stages. Tree-focus Enter is unbound, so a pin can neither dispatch its gate action nor reveal its underlying node.

## Decision ledger

- Dispatch `approve` and `reject` only from a selected awaiting-gate attention row through the same daemon call and pipeline/stage/branch parameters as its target tree stage. Rules out a new command verb or RPC path.
- Refuse `approve` and `reject` on a rejected-gate or failure attention row with `not_awaiting_stage`. Rules out silent no-op or a new error code.
- Bind tree-focus Enter on an attention row to select its target node; existing selected-ancestor expansion reveals it. Rules out mutating explicit expansion state.
- Leave tree-focus Enter inert for non-attention rows. Rules out making Enter a second expansion binding.
- Preserve command-focus Enter as submit. Rules out stealing the dock editor key.
- Advertise reveal in tree hints only while an attention row is selected. Rules out a permanently inapplicable hint.

## Acceptance criteria

- [ ] `approve` on an awaiting-gate attention row issues `pipeline_approve` with the same parameters as its target tree stage; a `tui-entry.test.tsx` case fails against the pre-fix selection refusal.
- [ ] `reject` on an awaiting-gate attention row issues `pipeline_reject` through the same target resolution.
- [ ] `approve` or `reject` on a rejected-gate or failure attention row reports `not_awaiting_stage` and sends no RPC.
- [ ] Tree-focus Enter on an attention row selects and reveals its target with ancestors expanded; a `tui-entry.test.tsx` case fails against the pre-fix unbound key.
- [ ] Tree-focus Enter on a tree row leaves selection and explicit expansion unchanged.
- [ ] Command-focus Enter still submits the command buffer.
- [ ] Tree hints advertise reveal only for an attention selection.
- [ ] `tui-entry.test.tsx` — `attention commands act only on awaiting-gate pins`; Mutation checkpoint: inverting the awaiting-gate eligibility guard makes the scoped test fail.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe and § Dock commands — gate action from attention rows, failure refusal, and tree-focus Enter reveal.
- `v2/docs/v1-behaviors.md` § TUI / observability — widened gate-action selection and the tree-focus Enter binding.

## Prerequisites

- The dock reports `N running · N awaiting gate · N failed · N done` over distinct pipeline and ad-hoc top-level work items.
- A pinned attention segment renders above the work tree with separately namespaced selectable row ids and target node ids.
- Attention rows lead selectable order and resolve the target node's existing right-pane detail.
- Gate attention rows carry the target pipeline, stage, and branch identity needed by approval dispatch.
- Existing `approve` and `reject` commands dispatch through the target pipeline's owning daemon and report typed selection errors without contacting it when ineligible.
- Selecting a tree descendant reveals its ancestors without writing explicit expansion state.
- Tree-focus and command-focus key handling are separate, and command-focus Enter submits the buffer.
