---
name: share-workflow-step-config-stamping
---

# Share workflow step-config stamping

## Prerequisites

## Problem

`prepareWorkflowSteps` is the only place write/review steps receive machine-config values (`iterationTimeoutMs`/`iterationCeilingMs`/`idleOutputMs`, `fixCommand`, `readyCommand`, `roleTimeoutMs`, `idleOutputMs`), and that mapping is private to the CLI `run workflow` path — pipeline dispatch never calls it.

## Behavior

Extract the `prepareWorkflowSteps` step-mapping core into one exported shared function that accepts built preset steps plus a machine-config path and returns steps with the same five config layers stamped today on the CLI path. `prepareWorkflowSteps` calls that function and keeps its existing build-then-stamp shape; no CLI-visible behavior change.

## Decisions

- Export a single shared stamping function from the workflow command layer (or a sibling module it owns) rather than duplicating mapping inside daemon code — rules out a second copy that can drift from CLI.
- Preserve today's unstamped-vs-default semantics: omit `fixCommand`/`readyCommand`/`idleOutputMs` properties when unconfigured; always stamp resolved write-path bounds and `roleTimeoutMs` — rules out forcing explicit defaults onto steps that today omit them.
- Deferred to first consumer: exact module path for the shared export — pin when daemon dispatch wires the import.

## Acceptance criteria

- [ ] `workflow.test.ts` ready-command, fix-command, iteration-bounds, review-timeout, and idle-budget tests stay green — behavior unchanged by the extraction.
- [ ] A structural test asserts CLI `prepareWorkflowSteps` stamps steps only through the shared export (no inline duplicate mapping) — fails if mapping is re-inlined in `workflow.ts`.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

None — CLI operator behavior is unchanged; pipeline parity is documented in the daemon intent.
