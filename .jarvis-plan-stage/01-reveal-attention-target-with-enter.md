# Reveal an attention target with Enter

## Problem

Tree-focus Enter is unbound, so a selected attention row cannot move selection to its underlying tree node.

## Decision ledger

- Bind tree-focus Enter on an attention row to select its `targetId` through the existing selection path. Rules out a separate navigation state or target-id alias remaining selected.
- Preserve `expandedPipelineNodeIds`; selected-ancestor expansion reveals the target. Rules out converting implicit reveal into durable explicit expansion.
- Leave tree-focus Enter inert on every non-attention row. Rules out making Enter a second expansion binding.
- Preserve command-focus Enter as command submission. Rules out routing editor Enter to tree activation.
- Add an Enter-reveal tree hint only for an attention selection. Rules out a permanently inapplicable hint.

## Tasks

- Expose attention-target activation through the monitor controls and bind tree-focus Enter without changing command-focus input routing.
- Select the target through normal state/scroll follow so implicit ancestor expansion reveals it without changing explicit expansion state.
- Extend `v2/src/tui/tui-entry.test.tsx` and dock-hint coverage with in-body mutation directives for binding, eligibility, selection, and hint guards.
- Update the attention navigation contract in `v2/docs/operator-runbook.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] In `v2/src/tui/tui-entry.test.tsx`, tree-focus Enter on an attention row selects its target node, reveals it with ancestors expanded, and leaves `expandedPipelineNodeIds` unchanged.
- [ ] In `v2/src/tui/tui-entry.test.tsx`, tree-focus Enter on a pipeline, branch, stage, run, or ad-hoc tree row leaves selection and explicit expansion unchanged.
- [ ] In `v2/src/tui/tui-entry.test.tsx`, command-focus Enter still submits the retained command buffer and does not activate an attention target.
- [ ] In `v2/src/tui/tui-entry.test.tsx`, tree hints advertise Enter reveal only while an attention row is selected; command hints remain `Esc tree · Enter submit`.
- [ ] `v2/src/tui/tui-entry.test.tsx` — `tree Enter reveals only an attention target`; Keystone checkpoint: removing the tree-focus Enter activation makes the scoped test fail against the pre-fix unbound behavior.
- [ ] `v2/src/tui/tui-entry.test.tsx` — `tree Enter reveals only an attention target`; Mutation checkpoint: inverting each added or modified focus, attention-selection, target, or hint guard makes the scoped test fail, including unchanged-state negative cases.
- [ ] `v2/docs/operator-runbook.md` documents tree-focus Enter reveal and its contextual hint; `v2/docs/v1-behaviors.md` records the binding and preserved explicit expansion state.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — tree-focus Enter reveal, inert tree rows, command-focus preservation, and contextual hint.
- `v2/docs/v1-behaviors.md` § TUI / observability — attention-target Enter binding.
