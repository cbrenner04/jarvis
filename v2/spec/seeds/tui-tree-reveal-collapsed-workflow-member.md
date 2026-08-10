---
name: tui-tree-reveal-collapsed-workflow-member
---

# Reveal a collapsed non-representative workflow member as its own painted tree row

## Problem

Split from `tui-attention-row-enter-reveal`: when a reveal target is a run that is a collapsed workflow group's *non-representative* member, selecting its id today either selects an invisible id or aliases to the group's representative row, so the operator cannot land selection on the actual member. The projection must be able to materialize such a member as its own painted tree row with its ancestors expanded. This is a prerequisite for the collapsed-target case of the Enter-reveal feature; land it before wiring Enter to reveal collapsed members.

## Decisions

- Selecting a collapsed non-representative workflow member's run id paints that member as its own tree row, with its pipeline, branch (when present), and stage ancestors expanded — not the group representative and not an invisible id. Rules out alias-to-representative and select-invisible.
- The reveal leaves the caller-supplied explicit expansion set (`expandedPipelineNodeIds`) unmodified; ancestor reveal is implicit via selected-ancestor expansion, not durable expansion writes. Rules out mutating explicit expansion state.
- Scope to the tree projection / selectable-row materialization; input bindings and the attention segment are unchanged. Rules out coupling this to the Enter binding.

## Acceptance criteria

- [ ] Selecting a collapsed non-representative workflow member's run id materializes that member as its own painted selected tree row with pipeline/branch/stage ancestors expanded; a `tui-monitor-lines.test.ts` (or `tui-monitor-pipeline-tree.test.ts`) regression pins it and fails against the pre-fix alias/invisible behavior, carrying a linkable `// @mutate` directive on the materialization guard.
- [ ] The reveal leaves the explicit expansion set unchanged; a regression pins the no-explicit-write invariant.
- [ ] A representative member and an already-visible member are unaffected (no double-paint, stable node ids).
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` § TUI / observability — collapsed non-representative member reveal-as-painted-row and preserved explicit expansion state.
