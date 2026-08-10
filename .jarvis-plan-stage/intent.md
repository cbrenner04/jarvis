---
name: tui-tree-reveal-collapsed-workflow-member
---

# Reveal a collapsed non-representative workflow member as its own painted tree row

Single module-boundary surface — the monitor tree projection in `v2/src/tui/tui-monitor-pipeline-tree.ts` (with its collapse helper `tui-monitor-workflow-collapse.ts` in the same seam) owns both member materialization and selected-ancestor expansion, so splitting does not apply.

## Prerequisites

## Problem

When the selected node id is a run that belongs to a collapsed workflow group but is not that group's representative, the projection either aliases selection onto the representative row or leaves it pointing at an id no row carries. The operator cannot land selection on the actual member. Prerequisite for wiring Enter-reveal to collapsed targets.

## Decisions

- Selecting a collapsed non-representative workflow member's run id materializes that member as its own painted tree row with pipeline, branch (when present), and stage ancestors expanded — rules out alias-to-representative and select-invisible.
- Ancestor reveal goes through the existing selected-ancestor expansion path; `expandedPipelineNodeIds` is left unmodified — rules out durable expansion writes for a transient reveal.
- Scope stops at the tree projection; input bindings and the attention segment are untouched — rules out folding the Enter binding into this change.

## Acceptance criteria

- [ ] Selecting a collapsed non-representative workflow member's run id materializes that member as its own painted selected tree row with pipeline/branch/stage ancestors expanded; a regression in `v2/src/tui/tui-monitor-pipeline-tree.test.ts` pins it, fails against the pre-fix alias/invisible behavior, and carries a `// @mutate` directive inside the test body naming the mutation on the member-materialization guard.
- [ ] The reveal leaves the caller-supplied explicit expansion set unchanged; a regression pins the no-explicit-write invariant.
- [ ] A representative member and an already-visible member are unaffected: no double-painted row, node ids stable.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` § TUI / observability — collapsed non-representative member reveals as its own painted row; explicit expansion state preserved.
