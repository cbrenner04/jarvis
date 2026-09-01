---
name: align-docs-after-write-retirement
---

# Align operator docs after write and alias retirement

## Prerequisites

- `jarvis write` is unknown at dispatch and absent from `jarvis help`; the CLI write command surface and `CliDeps.executeWriteLoop` path are removed while `parseWriteCliInput` remains for `jarvis run start`.
- `run workflow intent-reviewed`, `plan-reviewed`, and `plan-reviewed-light` resolve to unknown-workflow errors with no deprecation plumbing.

## Problem

Operator docs still demo `jarvis write` and the removed alias strings as supported commands.

## Behavior

No durable doc presents `jarvis write` as a command. Examples that taught direct write admission re-point to `run workflow` (or existing workflow/pipeline paths). `write-behavior.md` retitles its CLI examples around `run workflow`.

## Decision ledger

- Re-point write demos to `run workflow`; rules out leaving a removed command in operator-facing docs.
- Scope to listed durable homes only; rules out rewriting completed spec archives or historical PR bodies.

## Acceptance criteria

- [ ] A repo grep over `v2/docs/`, `README.md`, and lint-covered markdown finds no `jarvis write` presented as a command; `bun run lint:md` passes.
- [ ] `v2/docs/write-behavior.md` examples use `run workflow` admission, not `jarvis write`.
- [ ] `bun run typecheck` passes.

## Documentation updates

- `README.md` — replace `jarvis write` demo with `run workflow`.
- `v2/docs/write-behavior.md` — retitle CLI examples around `run workflow`.
- `v2/docs/install-and-config.md` — remove or re-point `jarvis write` references.
- `v2/docs/agent-model-config.md` — remove or re-point `jarvis write` references.
- `v2/docs/daemon-host.md` — remove or re-point `jarvis write` references.
- `v2/docs/v1-behaviors.md` — align any remaining write-command catalog prose with the retired command (if not fully updated by prior slices).
