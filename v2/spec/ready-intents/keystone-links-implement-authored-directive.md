---
name: keystone-links-implement-authored-directive
---

# Keystone criteria are satisfied by the directive the implement lands, including greenfield pins

## Problem

Implement completion refuses `spec.criteria-ticked` with `Unlinked keystone checkpoints (no directive linked on the named pin)` whenever a ticked keystone criterion has no `// @mutate` directive linked to it. Plans that phrase the checkpoint in prose — and greenfield subspecs whose pinning file does not exist at plan time — cannot carry a plan-time literal, so the implement blocks even with code, tests, and a green suite on disk (observed 2026-08-09, `tui-attention-segment-rows`, plan #2774; the entry run is non-resumable so the whole spec strands). Plan-agent variance currently decides implementability: codex-authored plans embedded literal directives and passed; the claude-authored plan did not.

## Behavior

A ticked keystone criterion that names its pinning test (file and enclosing test title) is satisfied when the implement writes that test and lands a linked `// @mutate` directive inside it, whether or not the plan contained a literal directive, and whether or not the pinning file existed at plan time. When the pin resolves but carries no linked directive, the implement is re-prompted to author one on that pin — naming the criterion and pin — before the contract is judged again. A keystone ticked with no directive anywhere in the enclosing test still fails the contract with the unlinked blocker; the mutation verifier's behavior once a directive is linked is unchanged.

## Prerequisites

- Implement completion runs the `spec.criteria-ticked` contract and refuses ticked keystone criteria whose pin carries no linked `// @mutate` directive.
- The mutation-checkpoint verifier resolves a criterion's pinning test path and links directives to a criterion by enclosing test title.
- The write loop can re-prompt the agent with mutation-directive context recovered from the run log.

## Documentation updates

- `v2/docs/operator-runbook.md` — keystone criteria need a linkable directive, how greenfield keystones resolve after the implement writes the file, and recovery when a run strands on `Unlinked keystone checkpoints`.
- `v2/docs/workflow-runner.md` — the implement-link contract for keystone criteria.
- `v2/docs/v1-behaviors.md` — record the changed completion behavior.
