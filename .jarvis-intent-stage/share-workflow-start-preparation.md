---
name: share-workflow-start-preparation
---

# Share workflow-start preparation

## Prerequisites

## Primary implementation surface

- CLI workflow admission in `v2/src/commands/workflow.ts`

## Problem

- CLI workflow admission owns posture realization, preset building, step stamping, and stale-reset sequencing as private command logic.
- Pipeline dispatch cannot reuse that complete preparation contract without copying it.

## Behavior

- One shared preparation API resolves a normalized workflow request through realizability, preset selection, step building, machine-config stamping, and stale-reset preflight.
- `run workflow` parses argv, adapts it to the normalized request, then preserves its existing recovery, output, detach, and wait behavior.
- Workflow/review realizability and its preset realization have one production authority.

## Decision ledger

- Land the shared API with the CLI as its first consumer; rules out an unconsumed abstraction whose contract is guessed before a caller needs it.
- Keep argv parsing, legacy aliases, detach, recovery, output, and waiting in the CLI adapter; rules out leaking operator transport concerns into shared preparation.
- Move realizable workflow/review mapping behind the preparation API; rules out retaining CLI-parser and pipeline-definition tables joined only by an alignment test.

## Acceptance criteria

- [ ] CLI tests pin unchanged `intent`, `plan`, and `implement` step arrays and stale-reset outcomes while `runWorkflowCommand` delegates preparation to one shared call target.
- [ ] A structural test rejects a second production realizability or preset-mapping table outside the shared preparation owner.
- [ ] Existing CLI recovery, legacy-alias, detach, output, and wait tests stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/v2-architecture.md` — shared workflow-start preparation boundary and thin CLI adapter.
- `v2/docs/workflow-runner.md` — normalized preparation ownership before daemon admission.
- `v2/docs/v1-behaviors.md` — record unchanged CLI workflow-start semantics through the shared preparation boundary.
