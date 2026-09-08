---
name: run-review-finalization-with-resolved-gate-commands
---

# Run Review Finalization with Resolved Gate Commands

## Module-boundary surface

Execution loop.

## Problem

Review-owned finalization can reach the ready gate without the reviewed project's command, causing the gate to fall back to `bun run ready` after the workflow's write work and publication have succeeded.

## Behavior

Finalization and ready-gate repair consume the gate-running step's resolved `readyCommand` and `fixCommand` on fresh dispatch and gate-only continuation. The built-in `bun run ready` behavior remains unchanged when no project override was admitted. Missing-command terminal evidence records whether the executed command was configured or the built-in default.

## Prerequisites

- Workflow admission stamps configured `readyCommand` and `fixCommand` onto write, review, and review-debate steps while leaving absent overrides unstamped.
- Workflow snapshot persistence round-trips review and review-debate gate commands and exposes the dispatch-time values to continuation.

## Decisions

- Finalization reads commands from the step that owns the gate-running boundary; rules out defaulting by behavior and borrowing an in-scope write sibling.
- Gate-only continuation uses snapshot-backed commands; rules out silently switching to current config or the built-in default after dispatch.
- Missing-command evidence records a configured-versus-default source alongside the normalized command; rules out inferring source from command text when a configured value equals the default.
- Projects without `readyCommand` still execute `bun run ready`; rules out changing the default while fixing propagation.

## Acceptance criteria

- [ ] A workflow-runner regression proves review-owned finalization for a project configured with a non-bun `readyCommand` invokes that command instead of `bun run ready`; it fails against the pre-fix undefined resolution.
- [ ] A gate-only continuation regression proves a persisted review-row `readyCommand` is invoked after reload even when live config differs.
- [ ] A ready-gate repair regression proves a review-row `fixCommand` reaches the configured autofix path.
- [ ] Missing-command `loop_finished` evidence identifies the normalized command and whether its source is configured or default.
- [ ] The existing no-override `bun run ready` regression stays green in `v2/src/execution/ready-finalize.test.ts`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — document project-keyed command resolution for gate-owning steps, continuation semantics, and configured-versus-default terminal evidence.
- `v2/docs/v1-behaviors.md` — update the v2 parity entry from write-step-only propagation to gate-owning-step propagation and snapshot-backed continuation.
