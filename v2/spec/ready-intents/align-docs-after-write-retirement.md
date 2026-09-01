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

No durable doc presents `jarvis write` or the retired `run workflow` alias strings (`intent-reviewed`, `plan-reviewed`, `plan-reviewed-light`) as supported CLI commands. Examples that taught direct write admission re-point to `run workflow` (or existing workflow/pipeline paths). `write-behavior.md` retitles its CLI examples around `run workflow`. Pipeline preset names and internal preset resolution in `workflow-presets.ts` stay documented where they describe execution stages, not CLI admission.

## Decision ledger

- Re-point write demos to `run workflow`; rules out leaving a removed command in operator-facing docs.
- Own the comprehensive `v1-behaviors.md` catalog sweep; code intents carry only minimal per-surface notes there.
- Scope to listed durable homes only; rules out rewriting completed spec archives or historical PR bodies.

## Acceptance criteria

- [ ] A repo grep over `v2/docs/`, `README.md`, and lint-covered markdown finds no `jarvis write` or `run workflow intent-reviewed` / `plan-reviewed` / `plan-reviewed-light` presented as supported CLI commands; `bun run lint:md` passes.
- [ ] `v2/docs/write-behavior.md` examples use `run workflow` admission, not `jarvis write`.
- [ ] `bun run typecheck` passes.

## Documentation updates

- `README.md` — replace `jarvis write` demo with `run workflow`.
- `AGENTS.md` — remove `write` from the command inventory; align alias guidance with canonical `intent` / `plan` plus review flags.
- `v2/docs/write-behavior.md` — retitle CLI examples around `run workflow`; remove or re-point retired alias strings as CLI commands.
- `v2/docs/workflow-runner.md` — remove or re-point retired alias strings as `run workflow` CLI commands; preserve pipeline preset stage names where they describe execution, not admission.
- `v2/docs/operator-runbook.md` — remove or re-point `jarvis write` and retired alias strings as supported CLI commands.
- `v2/docs/install-and-config.md` — remove or re-point `jarvis write` references.
- `v2/docs/agent-model-config.md` — remove or re-point `jarvis write` references.
- `v2/docs/daemon-host.md` — remove or re-point `jarvis write` references; preserve pipeline preset stage names in the stage table.
- `v2/docs/v1-behaviors.md` — comprehensive catalog sweep for retired `jarvis write` and rejected alias CLI admission (minimal per-surface notes from prior slices may remain).
