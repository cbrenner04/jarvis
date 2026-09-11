---
name: bulk-terminal-run-dismissal-store
---

# Dismiss a terminal run selection durably

## Prerequisites

## Primary implementation surface

`v2/src/persistence/state-store.ts`

## Problem

The store can dismiss only one known run ID. Higher layers cannot ask it to mark a complete project selection without reproducing durable status, dismissal, and workflow-invocation rules outside the persistence boundary.

## Behavior

- The state store atomically dismisses every previously undismissed terminal run matching an exact project selection, includes terminal step rows belonging to matched workflow-entry invocations, leaves every nonterminal row and lifecycle field unchanged, and returns the number of rows newly dismissed.

## Decisions

- Match the durable project field exactly and operate over all durable rows; rules out inheriting the default list retention window.
- Expand matched workflow-entry invocations to their terminal step rows; rules out orphan step rows while preserving the no-bulk-dismissal-of-live-work boundary.
- Keep single-ID dismiss and undismiss behavior unchanged; bulk undismiss and pipeline dismissal are out of scope.

## Acceptance criteria

- [ ] A state-store regression test proves one exact project selection dismisses all matching terminal rows, including terminal workflow step rows, while leaving another project's rows and every nonterminal row unchanged; it fails against the pre-fix single-ID store contract.
- [ ] A state-store test proves the operation returns the number of rows newly dismissed and a repeat call returns zero without changing the first dismissal timestamps.
- [ ] A state-store test proves selection bypasses list retention and changes only `dismissedAt`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` — bulk terminal selection, workflow-step expansion, atomicity, count semantics, and lifecycle invariants.
