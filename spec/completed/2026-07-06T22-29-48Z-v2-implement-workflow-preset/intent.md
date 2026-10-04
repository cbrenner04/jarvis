---
name: v2-implement-workflow-preset
---

# `implement` workflow preset

Add a named `implement` workflow preset: one `write` step, `role: implement`, a pinned `promptId` for the patch/implement body, and the standard artifact/spec contract from `write-behavior.md`. Demote `write-write` to test-only — drop it from any operator-facing docs/examples, keep `resolveWorkflowPreset("write-write", …)` only for composability tests.

## Decisions

- Preset lives alongside the existing `WORKFLOW_PRESET_LENGTHS`/`resolveWorkflowPreset` surface in `v2/src/execution/workflow-runner.ts` (or a co-located module), not a new ad hoc shape.
- `implement` is a 1-step preset: same validation contract as `write-write` (unknown name throws, wrong step count throws).
- `promptId` and default `stepRules`/contract pattern are preset-owned, not caller-supplied.

## Prerequisites

- `resolveWorkflowPreset(name, steps)` exists and validates named presets by fixed step count.
- Write steps support a per-step `promptId`.

## Out of scope

- Daemon/CLI launch surface (separate intent).
- Full `plan` or `yolo` presets.
- Auto-triggered shrink (not landed in v2 yet).
