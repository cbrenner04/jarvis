---
name: dismiss-run-durable-flag
---

# Dismiss Run Durable Flag

## Primary implementation surface

`v2/src/persistence/state-store.ts`

Unsplit rationale: The whole change is one additive nullable column plus its migration and the dismiss/undismiss run operations on a single persistence module; there is no second module boundary to split across.

## Prerequisites

- A pipeline carries a nullable durable dismissal timestamp with `dismissPipeline`/`undismissPipeline` store operations and a `027-pipeline-dismissed-at` migration, as the shape to mirror.

## Surface

State store.

## Problem

- The run row has no durable field an operator can set to mark a run dismissed, and no store operation to set or clear it. Every consumer that would hide a dead terminal run — the `list` request, `jarvis run list`, the TUI work tree — has nothing durable to read or write. This is the foundation the `dismiss-run-rpc`, `dismiss-run-cli`, and `dismiss-run-tui-display` intents list under Prerequisites.

## Behavior

- A run carries a nullable durable dismissal timestamp (`dismissedAt`) that survives reopening the state store, plus dismiss and undismiss store operations that set and clear it and leave run status, attempts, and workflow snapshot untouched.

## Decisions

- Add the dismissal as an additive nullable column on the runs table with a forward migration, mirroring the pipeline column; rules out an in-memory or process-local flag that would not survive a daemon restart.
- Provide `dismissRun(id)`/`undismissRun(id)` returning the same dismissal-outcome shape as the pipeline pair; rules out folding dismissal into a status mutation, which would couple it to run lifecycle.
- Dismissal is orthogonal to lifecycle and to the terminal-retention window: the operations touch only the dismissal column, and a dismissed run stays loadable by id; rules out reusing the kill or reconciliation path, and rules out deleting the durable row.
- Repeat dismiss preserves the first dismissal timestamp; undismiss of a never-dismissed run reports an already-clear outcome rather than failing; rules out clobbering the original timestamp and rules out treating a redundant undismiss as an error.
- Project `dismissedAt` through the run columns so higher layers can filter and mark on it; rules out an out-of-band second lookup.
- Both operations address an unknown run id with a named error; rules out silent success on a mistyped id.

## Required verification

- A state-store test dismisses a run, reopens the store, and asserts `dismissedAt` persists on the loaded run; it fails against the pre-migration schema.
- A state-store test asserts a second dismiss preserves the first timestamp, and that undismiss clears it back to null.
- A state-store test asserts undismiss of a never-dismissed run returns the already-clear outcome.
- A state-store test asserts dismiss/undismiss leave run status, attempts, and workflow snapshot unchanged.
- A state-store test asserts an unknown run id is addressed with a named error on both operations.

## Documentation updates

- `v2/docs/state-store.md` — the durable run dismissal column, its migration, and the dismiss/undismiss run operations, noting parity with the pipeline pair.
