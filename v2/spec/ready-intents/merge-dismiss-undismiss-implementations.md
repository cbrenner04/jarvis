---
name: merge-dismiss-undismiss-implementations
---

# Unify run and pipeline dismissal implementations

## Problem

`run dismiss/undismiss` (run.ts) and `pipeline dismiss/undismiss` (pipeline.ts) are near-identical implementations landing a day apart, duplicating the mutation-checkpoint and list-display logic. Both verbs are documented and used; only the implementation duplication should go.

## Decisions

- Extract a shared dismissal handler function (or module) that accepts a dismissal mode (dismiss|undismiss), row kind (run|pipeline), and selector, returning the mutation checkpoint and display message.
- Both `run` and `pipeline` commands continue to expose their own `dismiss` and `undismiss` verbs (no CLI surface change).
- Rules out collapsing the verbs or breaking the user CLI surface.

## Prerequisites

## Acceptance criteria

- [ ] A shared dismissal function or module is extracted and invoked by both run and pipeline commands; the source functions are simplified or deleted.
- [ ] `run.test.ts` dismiss tests stay green (behavior unchanged by extraction).
- [ ] `pipeline.test.ts` dismiss tests stay green (behavior unchanged by extraction).
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- None — dismissal behavior and surface are unchanged.

## Primary implementation surface

- `v2/src/commands/run.ts` (refactor dismiss/undismiss to call shared handler)
- `v2/src/commands/pipeline.ts` (refactor dismiss/undismiss to call shared handler)
- A new shared module or function (e.g., `v2/src/commands/dismissal-common.ts` or injected into an existing utilities file)
