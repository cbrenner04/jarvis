---
name: tui-attention-segment-rows
---

# Pinned attention segment above the work tree

## Problem

The command center's first question is "what needs me" and the left pane never answers it. Gates, failed stages, dead runs, and terminal-publication failures are ordinary rows buried in a tree ordered by rank and age — six pipelines sat at approval gates for up to six days with nothing surfacing them. The operator has to walk the tree to find anything actionable.

## Decisions

- A pinned segment renders above the work tree in the left pane, capped at 6 rows plus a `+N more` overflow row. Rules out attention-by-scrolling.
- Row sources: awaiting gates, rejected gates, failed stages, failed runs, blocked runs, terminal-publication failures. Rules out pinning every non-success stage — skipped placeholders would flood the cap.
- Order: gates before failures; oldest first within each group. Rules out one merged oldest-first list, which lets an old failure push out a live gate.
- Row content: glyph (`✋` gate, `✗` failure) · what (stage id, or run role for an ad-hoc item) · where (pipeline seed slug › branch, or the ad-hoc item's label) · since.
- `since` for a gate is measured from its predecessor stage's `endedAt`, for a stage failure from that stage's `endedAt`, for a run failure from the run's `finishedAtMs`. Rules out pipeline `createdAt`, which reads as days on a gate reached minutes ago.
- A pure builder maps `(pipeline snapshots, run rows)` to rows carrying kind, target node id, and since; painting and selection consume its output. Rules out deriving rows inside the renderer, where the cap and ordering are untestable.
- Attention row ids are their own namespace and carry the target node id separately. Rules out reusing the target node id as the row id, which would match both the attention row and its tree row in selection and marker painting.
- Attention rows precede tree rows in the selectable order; selecting one renders the target node's existing right-pane detail. Rules out a bespoke attention detail view.
- The `+N more` row is not selectable and carries no target.
- Empty attention state renders nothing — no heading, no rows. Rules out a persistent heading that costs a row per refresh.
- Pins have no dismissal: a pin clears when its source clears or the item leaves daemon retention. Rules out a dismiss verb — command-grammar changes are a phase non-goal.
- Acting on a row is out of scope here; this intent delivers derivation, painting, selection, and detail only.

## Acceptance criteria

- [ ] A pure builder maps pipeline snapshots plus run rows to attention rows and pins one row for each source — awaiting gate, rejected gate, failed stage, failed run, blocked run, terminal-publication failure — each carrying its kind, target node id, and since-timestamp; a new `tui-attention-rows.test.ts` covers all six sources and fails against the pre-fix code, which has no builder.
- [ ] Seven actionable items render six rows plus a `+N more` row.
- [ ] Ordering pins gates before failures and, within each group, oldest first.
- [ ] A gate row's since is measured from its predecessor stage's end, not from pipeline creation.
- [ ] Attention rows precede every tree row in `monitorSelectableNodeIds`, and selecting one renders the target node's right-pane detail; a `tui-monitor-lines.test.ts` test fails against the pre-fix code.
- [ ] The `+N more` row is absent from the selectable ids.
- [ ] With no actionable items the left pane paints zero attention rows and no heading.
- [ ] Selecting an attention row leaves the tree's scroll offset and expansion set unchanged (`tui-monitor-lines.test.ts` scroll-follow tests stay green).
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — the pinned segment: sources, glyphs, row anatomy, cap and `+N more`, ordering, empty state, and that attention rows lead the `j`/`k` order with the target node's detail in the right pane.
- `v2/docs/v1-behaviors.md` § TUI / observability — record that the selectable order now leads with attention row ids and that right-pane detail resolves through an attention row's target node.

## Prerequisites

- Every top-level work item — pipeline and ad-hoc workflow-invocation group — is a node in one left-pane work tree, with the Unattributed segment and its FIFO deleted.
- `monitorSelectableNodeIds` derives the selectable order from the full flattened tree rows, not the painted viewport slice.
- The right pane resolves its detail from `selectedNodeId` against the full flattened tree rows.
- The dock status line reports `N running · N awaiting gate · N failed · N done` over pipelines and ad-hoc items.
- Every terminal stage carries `endedAt` and every terminal run reports non-null `finishedAtMs` on the daemon wire, including a stage that failed before start (`startedAt` null).
- `pipeline_list` projects per-stage `stageId`, `branchKey`, `status`, `startedAt`, and `endedAt`, plus pipeline `seedPath` and `terminalPublicationFailure`.
- `monitorPipelineStageNodeId` yields the tree node id for a pipeline stage on a branch.
