---
name: share-workflow-start-preparation
---

# Share workflow-start preparation

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
- [ ] `v2/src/commands/workflow.test.ts` — `recovery uses the implement completion traversal and canonical spec identity`, `run workflow implement detaches an admitted recovery`, `run workflow intent with --detach prints intent paths stderr before run ID without client wait`, and `run workflow implement sends start and wait IPC requests, blocks on completion, and prints run ID and wait JSON` stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/v2-architecture.md` — shared workflow-start preparation boundary and thin CLI adapter.
- `v2/docs/workflow-runner.md` — normalized preparation ownership before daemon admission.
- `v2/docs/v1-behaviors.md` — record unchanged CLI workflow-start semantics through the shared preparation boundary.

## Prerequisites

## Blocker

Artifact contract check failed: Plan subspec 01-cli-delegates-workflow-start-preparation.md has a multi-surface ## Acceptance criteria bullet: A new regression in `v2/src/commands/workflow.test.ts`, `run workflow intent plan and implement preserve prepared start steps through the shared owner`, fails against the pre-fix private command path and proves each parsed CLI request reaches the shared preparation target once and sends the unchanged built-and-stamped step array to daemon `start`.
