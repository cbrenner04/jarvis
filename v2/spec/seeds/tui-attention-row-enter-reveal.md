---
name: tui-attention-row-enter-reveal
---

# Reveal an attention target with tree-focus Enter

## Problem

Deferred subspec 01 of `tui-attention-row-act-in-place` (subspec 00, dispatch gate commands from attention rows, shipped 2026-08-10 in #2804). Tree-focus Enter is unbound, so a selected attention row can surface an incident but cannot move selection to its underlying tree node. Scoped here to the common case — a target already present in the tree; the collapsed non-representative run-member reveal is a separate projection concern deferred to the `tui-tree-reveal-collapsed-workflow-member` seed.

## Decisions

- Bind unmodified tree-focus Enter on an attention row to select its `targetId` through the existing selection path. Rules out a separate navigation state and alias selection.
- Preserve `expandedPipelineNodeIds`; selected-ancestor expansion reveals the target and scroll-follow brings its painted row into the viewport. Rules out converting implicit reveal into durable explicit expansion.
- Leave tree-focus Shift+Enter and Enter on every non-attention row inert; preserve command-focus Enter as command submission. Rules out a second activation binding or stealing the dock editor key.
- Add an Enter-reveal tree hint only while an attention row is selected. Rules out a permanently inapplicable hint.
- The keystone/mutation checkpoints must carry linkable `// @mutate` directives (or be authored so the implement can link them), per #2806 — rules out re-stranding on prose-only checkpoints.

## Acceptance criteria

- [ ] Tree-focus Enter on a selected attention row selects its target, leaves `expandedPipelineNodeIds` unchanged, and produces a painted selected tree row inside the scroll-follow viewport with every required ancestor expanded; a `tui-entry.test.tsx` regression pins it and fails against the pre-fix unbound key. This regression carries a linkable `// @mutate` directive on the Enter-binding guard.
- [ ] Tree-focus Enter and Shift+Enter on a pipeline, branch, stage, run, or ad-hoc tree row leave selection and explicit expansion unchanged (existing `tui-entry.test.tsx` non-attention-row Enter/Shift+Enter coverage stays green).
- [ ] Tree hints advertise Enter reveal only while an attention row is selected; command-focus Enter still submits (existing `submits only focused command input` and command-hint tests stay green).
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe and § Dock commands — tree-focus Enter reveal from an attention row and its contextual hint.
- `v2/docs/v1-behaviors.md` § TUI / observability — the attention-target Enter binding and preserved explicit expansion state.
