---
name: dismiss-pipeline-durable-flag
---

# Dismiss Pipeline Durable Flag

## Primary implementation surface

`v2/src/persistence/state-store.ts`

Unsplit rationale: The whole change is one additive nullable column plus its migration and the dismiss/undismiss store operations on a single persistence module; there is no second module boundary to split across.

## Prerequisites

- None. This is the store-layer foundation the `dismiss-pipeline-rpc`, `dismiss-pipeline-cli`, and `dismiss-pipeline-tui-display` intents depend on.

## Surface

State store.

## Problem

- The pipeline row has no durable field an operator can set to mark a pipeline dismissed, and no store operation to set or clear it. Every consumer that wants to hide an abandoned pipeline (`pipeline_dismiss` RPC, `jarvis pipeline dismiss`, the TUI work tree and needs-attention segment) has nothing durable to read or write. This is the shared foundation the `dismiss-pipeline-rpc`, `dismiss-pipeline-cli`, and `dismiss-pipeline-tui-display` intents list under Prerequisites.

## Behavior

- A pipeline carries a nullable durable dismissal timestamp (`dismissedAt`) that survives reopening the state store, plus dismiss and undismiss store operations that set and clear it and leave stage records and derived lifecycle state untouched.

## Decisions

- Add the dismissal as an additive nullable column with a forward migration on the pipelines table; rules out an in-memory or process-local flag that would not survive a daemon restart.
- Provide `dismissPipeline(id)` and `undismissPipeline(id)` store operations that set the timestamp and clear it to null respectively; rules out folding dismissal into an existing status mutation, which would couple it to lifecycle state.
- Dismissal is orthogonal to lifecycle: the operations touch only the dismissal column, never stage records, gate decisions, or derived pipeline state; rules out reusing the reject/kill path.
- Reading a pipeline row exposes `dismissedAt` so higher layers can project and filter on it; rules out an out-of-band second lookup.
- Both operations are idempotent (dismissing a dismissed pipeline, or undismissing a non-dismissed one, is a no-op success) and address an unknown pipeline id with a named error; rules out silent success on a mistyped id.

## Required verification

- A state-store test sets the dismissal on a pipeline, reopens the store, and asserts `dismissedAt` persists; it fails against the pre-migration schema.
- A state-store test asserts undismiss clears the timestamp back to null.
- A state-store test asserts dismiss/undismiss leave the pipeline's stage records and derived lifecycle state unchanged.
- A state-store test asserts an unknown pipeline id is addressed with a named error on both operations.

## Documentation updates

- `v2/docs/state-store.md` — the durable dismissal column, its migration, and the dismiss/undismiss operations.
