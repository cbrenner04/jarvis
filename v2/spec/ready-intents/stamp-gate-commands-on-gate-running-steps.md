---
name: stamp-gate-commands-on-gate-running-steps
---

# Stamp Gate Commands on Gate-Running Steps

## Module-boundary surface

CLI workflow admission.

## Problem

Machine-config stamping resolves `readyCommand` and `fixCommand` only for write steps, so review and review-debate steps lose their project's gate configuration before dispatch.

## Behavior

Resolve each step's project gate-command overrides at the shared workflow-admission stamping seam and carry them on write, review, and review-debate steps. Projects without an override keep the field absent.

## Prerequisites

## Decisions

- Gate-command stamping is keyed directly by each step's project across write, review, and review-debate behaviors; rules out behavior-local resolution and borrowing a write sibling's values.
- An absent project override remains unstamped; rules out changing the built-in machine-wide default while repairing propagation.

## Acceptance criteria

- [ ] A stamping regression proves review and review-debate steps carry configured `readyCommand` and `fixCommand` values, while a project without either override carries neither; it fails against the pre-fix write-only branch.
- [ ] Existing write-step stamping behavior stays green in `v2/src/commands/workflow.test.ts` and pipeline preparation parity tests.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/install-and-config.md` — state that per-project `readyCommand` and `fixCommand` are resolved for every workflow step that can own ready-gate finalization.
- `v2/docs/v1-behaviors.md` — update the v2 parity entry for gate-command admission stamping.
