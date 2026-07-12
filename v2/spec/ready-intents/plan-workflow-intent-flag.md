---
name: plan-workflow-intent-flag
---

# Rename `--ready-intent` to `--intent` on plan workflow presets

`jarvis run workflow plan | plan-reviewed | plan-reviewed-light` accepts the intent path as `--intent <path>` instead of `--ready-intent <path>`. Validation, normalization, and error paths are unchanged — only the flag spelling.

## Decisions

- Replace the flag outright; no `--ready-intent` alias — single operator, no back-compat surface.
- `--ready-intent` becomes an unknown flag: presets exit 1 pre-daemon with the updated usage string.
- Directory name `ready-intents/` is unchanged — out of scope.

## Scope

- `v2/src/cli.ts`: flag parsing and the three `WORKFLOW_PLAN*_USAGE` strings.
- Any plan-workflow builder that reads the parsed flag (`v2/src/execution/plan-workflow-steps.ts`).
- Tests co-located in `v2/src/cli.test.ts`.

## Documentation updates

- `v2/docs/workflow-runner.md` — CLI usage lines for the three plan presets.
- `v2/docs/first-workflow-walkthrough.md` — example commands.
- `v2/docs/v1-behaviors.md` — plan preset flag entries.

## Prerequisites
