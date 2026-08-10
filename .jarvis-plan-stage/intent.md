---
name: tui-attention-segment-rows
---

# Pinned attention segment above the work tree

## Problem

Awaiting and rejected gates, failed stages, dead runs, and terminal-publication failures remain buried in the work tree. The operator must walk it to discover actionable work.

## Decision ledger

- Render a pinned segment above the work tree, capped at six attention rows plus one `+N more` overflow row. Rules out attention-by-scrolling.
- Source rows from awaiting gates, rejected gates, failed stages, failed runs, blocked runs, and terminal-publication failures. Rules out pinning every non-success status, including skipped placeholders.
- Order gates before failures and oldest first within each group. Rules out an old failure displacing a live gate.
- Sort rows without a durable `since` after every dated row in their group, then by target node id. Rules out an undated legacy row consuming an oldest-first cap slot unpredictably.
- Render glyph (`✋` gate or `✗` failure), what (stage id or run role), where (pipeline seed slug › branch or ad-hoc label), and since. Rules out duplicating full tree rows.
- Derive awaiting-gate since from its predecessor finish, rejected-gate since from `decidedAt`, stage-failure since from `endedAt`, run-failure since from `finishedAtMs`, and publication-failure since from the pipeline terminal finish. Rules out using pipeline or run creation as a false failure time.
- Build rows in a pure `(pipeline snapshots, run rows)` projection carrying row kind, selectable row id, target node id, and nullable since timestamp. Rules out deriving cap and order inside the renderer.
- Keep a row whose legacy source lacks a durable timestamp and omit its age. Rules out fabricating a failure time from admission or refresh time.
- Namespace attention row ids separately from target node ids. Rules out one selection id matching both a pin and its tree row.
- Put attention rows before tree rows in selectable order and resolve their right pane through the target node's existing detail. Rules out a separate attention detail model.
- Keep the overflow row display-only with no target. Rules out navigation landing on a summary.
- Render no heading or rows when no actionable item exists. Rules out spending a pane row on an empty state.
- Clear pins only when their source clears or leaves daemon retention. Rules out dismissal state and a new command verb.
- Defer acting on attention rows to the interaction surface. Rules out mixing command dispatch into row derivation.

## Acceptance criteria

- [ ] A pure builder maps pipeline snapshots and run rows to one row for each source—awaiting gate, rejected gate, failed stage, failed run, blocked run, and terminal-publication failure—with kind, target node id, and nullable since timestamp; `tui-attention-rows.test.ts` covers all six and fails against the pre-fix code.
- [ ] Seven actionable items render six attention rows plus `+N more`; gates precede failures, each group is oldest first, and undated rows follow dated rows in target-node-id order.
- [ ] Awaiting-gate age starts at its predecessor's `endedAt`, rejected-gate age at `decidedAt`, and failure ages at their durable terminal timestamps.
- [ ] A legacy terminal run without `finishedAtMs` remains pinned with no age instead of using `createdAt` or the display clock.
- [ ] Attention row ids precede all tree node ids in `monitorSelectableNodeIds`; selecting one renders its target node's existing right-pane detail, and a `tui-monitor-lines.test.ts` case fails against the pre-fix code.
- [ ] The overflow row is not selectable.
- [ ] No actionable items paint no attention heading or row.
- [ ] Selecting an attention row leaves tree scroll offset and explicit expansion unchanged.
- [ ] `tui-attention-rows.test.ts` — `sorts undated rows after dated attention`; Mutation checkpoint: inverting the undated-row ordering guard makes the scoped test fail.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — sources, glyphs, row anatomy, cap, ordering, empty state, selectable order, and target detail.
- `v2/docs/v1-behaviors.md` § TUI / observability — attention-row selection ids and target-node detail resolution.

## Prerequisites

- The dock reports `N running · N awaiting gate · N failed · N done` over distinct pipeline and ad-hoc top-level work items.
- Pipelines and ad-hoc workflow-invocation groups are top-level nodes in one work tree.
- Selectable order derives from the full flattened work tree rather than its painted viewport.
- Right-pane detail resolves a selected tree node against the full flattened work tree.
- Current daemon terminal stage-run settlements carry `endedAt`, including failed-before-start stages with no synthesized `startedAt`.
- Current durable terminal run transitions project `finishedAtMs`; legacy or unbackfilled terminal rows may omit it.
- Pipeline snapshots project gate `decidedAt`, stage identity and timing, `seedPath`, `finishedAtMs`, and terminal-publication failure.
- The tree model exposes stable node ids for pipeline stages, attributed runs, and ad-hoc groups.
