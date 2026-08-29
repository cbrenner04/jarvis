---
name: require-complete-pipeline-context
---

# Require complete persisted pipeline context

## Prerequisites

- Shared workflow-start preparation requires an explicit machine-config path for config resolution and step stamping.

## Primary implementation surface

- Pipeline context persistence in `v2/src/persistence/state-store.ts`

## Problem

- Fresh pipeline starts use RPC-supplied context while continuation trusts an optionally shaped persisted JSON value.
- A persisted row without `configPath` can reach dispatch and trigger fallback behavior or a late generic failure.

## Behavior

- Pipeline admission schema-checks the context fields required by workflow preparation, including `configPath`, before persisting the immutable snapshot.
- Same-session starts and continuation load the persisted snapshot through one context loader.
- A legacy or malformed row missing a required field fails its stage with a named context-loader error and never dispatches with a default.

## Decision ledger

- Validate completeness at admission and again when loading persisted JSON; rules out trusting TypeScript types across RPC and storage boundaries.
- Treat `configPath` as required pipeline admission state; rules out completing it from operator-home config during continuation.
- Reload the durable context for fresh execution after admission; rules out fresh starts consuming different bytes from restart continuation.

## Acceptance criteria

- [ ] Pipeline admission rejects a context missing `configPath` before creating runnable stage state; the regression fails against the pre-fix permissive admission.
- [ ] A persisted context missing `configPath` fails the pending stage with a named context-loader error and records no workflow dispatch; the regression fails against the pre-fix loader path.
- [ ] A valid admitted `PipelineContext` persists and reloads with equal required field values for both fresh and continued execution.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` — required persisted `PipelineContext` fields and named load failure.
- `v2/docs/daemon-host.md` — pipeline admission and continuation consume the same validated durable context.
- `v2/docs/v1-behaviors.md` — replace optional-`configPath` pipeline context semantics with fail-closed loading.
