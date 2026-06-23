---
name: rename-wip-intents-dir-to-seeds
---

# Rename the `wip-intents/` seed directory to `seeds/`

## Problem

The raw-seed input directory is named `wip-intents/`, but the artifacts are
everywhere called **seeds**. "wip-intent" also collides with the distinct
*intent* pipeline artifact, so the name misleads.

## Behavior

`jarvis1 intent` reads file seeds from `<targetDir>/seeds/` instead of
`<targetDir>/wip-intents/`; the rejection message for a misplaced seed names
`seeds/`. The on-disk directory and all references are renamed accordingly.
Pure rename + reference update; no pipeline or semantic change.

Scope of references to update:
- code: `v1/src/commands/intent.ts` (seed-input path + rejection message)
- tests: `v1/test/intent-command.sandbox-unrunnable.test.ts`
- docs: `v1/docs/intent-mode.md`, `plan-mode.md`, `spec-guidance.md`,
  `workflows.md`, `operator-runbook.md`
- conventions: `CLAUDE.md`/`AGENTS.md`
- catalog: `v2/docs/v1-behaviors.md` (existing-behavior change)
- the directory itself (`v2/spec/wip-intents/` → `seeds/`) and seed cross-links

`ready-intents/` keeps its name (out of scope).

## Out of scope

- Changing what seeds are or the pipeline.
- Renaming `ready-intents/`.

## Prerequisites
