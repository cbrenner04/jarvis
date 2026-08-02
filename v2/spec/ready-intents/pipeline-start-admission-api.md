---
name: pipeline-start-admission-api
---

# Reusable pipeline start admission

## Problem

`jarvis pipeline start` owns project lookup, seed validation, pipeline resolution, RPC admission, CLI output, and attached waiting in one command handler. The TUI cannot reuse admission without duplicating policy or invoking the CLI as text.

## Decisions

- Extract a typed admission API for project plus seed path/text that returns an admitted pipeline id or a named failure — rules out stdout/stderr capture as an integration boundary.
- Keep project lookup, machine-model loading, seed containment, `resolveProjectPipeline`, and one `pipeline_start` request inside the shared admission path — rules out TUI-specific validation or RPC construction.
- Keep attached waiting and CLI formatting in the CLI adapter — rules out a reusable API that can block on pipeline completion.
- Preserve current `jarvis pipeline start` output and exit behavior — rules out an operator-visible CLI migration bundled with extraction.

## Acceptance criteria

- [ ] A reusable API resolves a registered project's configured pipeline and exactly one seed source before issuing one `pipeline_start`, returning the admitted pipeline id without waiting.
- [ ] Unregistered projects, missing or invalid pipeline config, invalid model config, and invalid seed paths fail before daemon contact with the current operator-facing detail.
- [ ] `v2/src/commands/pipeline.test.ts` pipeline-start attached, detached, seed-path, seed-text, and refusal tests stay green.
- [ ] A direct admission-API test fails against the pre-extraction code and proves no `pipeline_wait` occurs.
- [ ] Added or moved rejection guards have `// @mutate` checkpoints on their real source conditions; no production inversion hooks are added.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — record the shared pre-admission boundary and CLI-owned attach/wait behavior.
- `v2/docs/v1-behaviors.md` — record that the v2 pipeline-start CLI preserves behavior through the reusable admission path.

## Prerequisites

- `jarvis pipeline start` validates registered project config, model bindings, and exactly one seed source before daemon contact.
- `pipeline_start` accepts a validated definition and context, returns an admitted pipeline id, and leaves execution daemon-owned.
