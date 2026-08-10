# 01 - Attention segment paint and selection

## Problem

The attention projection from `00` has no consumer: the operator still walks the work tree to find awaiting gates, rejected gates, failed stages, failed and blocked runs, and terminal-publication failures.

## Decisions

- Paint the projection as a pinned segment above the work tree in the left pane: one heading row (literal text `Attention`), then the attention rows, then the tree. Rules out attention-by-scrolling.
- A row renders glyph (`✋` gate, `✗` failure), `what`, `where`, and age formatted from `sinceMs` through the existing wall-clock formatter; a `null` `sinceMs` renders no age. `✗` covers both `failed` and `blocked` runs — a blocked run is dead-ended pending operator action the same as a failed one, even though its worktree survives for resumption; that distinction is worktree state, not attention state, so it does not earn a separate glyph. Rules out a display clock standing in for a missing timestamp.
- A selected attention row renders the same selection marker a selected tree row renders. Rules out a selected pin showing no marker anywhere in the pane.
- The segment consumes left-pane row budget ahead of the tree, but reserves a minimum of 3 tree rows: when heading + capped rows + overflow would leave fewer than 3 rows for the tree, the segment drops its lowest-priority rows (last in sort order, overflow first) until the minimum is met. Rules out the segment starving the tree to zero rows on a short terminal.
- No actionable item paints no heading and no row. Rules out spending a pane row on an empty state.
- Attention row ids precede every tree node id in `monitorSelectableNodeIds`, so initial selection lands on the first attention row when one exists. Rules out interleaving pins with their tree rows, and rules out special-casing initial selection back to the tree.
- The overflow row is not selectable. Rules out navigation landing on a summary.
- Selecting an attention row adds nothing to `expandedPipelineNodeIds` and reveals no ancestors; the tree's own scroll offset is likewise untouched by pin selection. Rules out pin selection mutating tree state. (Right-pane detail resolution for the selected target is decided in `02`.)
- Dock verbs and keybind steering are unchanged: an attention-row selection is not a run or pipeline id, so it refuses through the same existing feedback codes the dock already uses for kill, approve/reject, and log-follow on a non-run/non-pipeline selection. Rules out mixing command dispatch into this change.
- Pins clear only when their source leaves the projection (source resolved, or row dropped from daemon retention). Rules out dismissal state and a new command verb. Pins are read-only: an operator who selects a pinned gate still walks into the tree to act on it. A successor intent (`act-on-attention-row`) can add direct dispatch from a selected pin later; out of scope here.

## Acceptance criteria

- [ ] With actionable work present, the left pane paints an `Attention` heading and the projection's rows above the first work-tree row, each showing its glyph, `what`, `where`, and age (no age when the source has no durable timestamp); `tui-monitor-lines.test.ts` — `paints the pinned attention segment above the work tree` fails against the pre-fix code.
- [ ] Attention row ids precede every tree node id in `monitorSelectableNodeIds`, and initial selection lands on the first attention row when one exists.
- [ ] A selected attention row renders the same selection marker a selected tree row renders.
- [ ] The `+N more` overflow row is present in the painted segment and absent from `monitorSelectableNodeIds`.
- [ ] With no actionable item, the left pane paints no attention heading and no attention row, and the tree viewport keeps its full row budget.
- [ ] On a terminal short enough that heading + six rows + overflow would leave fewer than 3 tree rows, the segment drops rows (overflow first, then lowest-priority attention rows) until the tree keeps at least 3 rows; painted left-pane rows never exceed the pane height.
- [ ] Given more than six actionable items where an older failure and a newer gate both compete for the last cap slot, the gate row is included and the older failure is not.
- [ ] Selecting an attention row leaves `leftPaneTreeScrollOffset` and `expandedPipelineNodeIds` unchanged.
- [ ] Dock steering (`kill`) with an attention row selected issues no RPC and reports an existing feedback code.
- [ ] `tui-monitor-lines.test.ts` — `keeps the overflow row unselectable`; Mutation checkpoint: inverting the overflow-row exclusion guard makes the scoped test fail.
- [ ] Every guard added by this subspec has a scoped test that fails when the guard is inverted, including the negative cases that suppress painting (empty projection paints no heading, overflow row yields no selectable id, short-terminal trimming keeps the tree minimum).
- [ ] `tui-monitor-lines.test.ts` — `orders attention row ids ahead of tree node ids`; Keystone checkpoint: reverting `monitorSelectableNodeIds` to tree rows only makes the scoped test fail.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — attention segment sources, glyphs (including `✗` covering both failed and blocked runs), row anatomy, six-row cap plus `+N more`, gates-before-failures oldest-first ordering with target-node-id tiebreak, undated rows last, minimum tree-row budget on short terminals, empty state, attention ids ahead of tree ids in walk order, and the read-only operator loop (select pin, then act from the tree).
- `v2/docs/v1-behaviors.md` § TUI / observability — attention row selection ids (`attention:<targetNodeId>`), their position in `monitorSelectableNodeIds`, initial-selection consequence, unselectable overflow row, and unchanged steering-refusal codes for an attention-row selection.
