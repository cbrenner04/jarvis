---
name: workflow-output-follows-input-surface
---

# Workflow output follows the input surface

Committed v2 `intent` and `plan` workflows currently route artifacts from
`plan.targetDir`, so v1 seeds and ready-intents can produce v2 artifacts.

Derive the default target directory from a canonical file input: a seed under
`<targetDir>/seeds/` lands reviewed intents under `<targetDir>/ready-intents/`, and a
ready-intent under `<targetDir>/ready-intents/` lands its plan tree under `<targetDir>/`.
Cover the canonical v1 and v2 surfaces through the primary presets and their review aliases.

## Decisions

- Explicit `--target-dir` wins over input routing; rules out overriding the per-run choice.
- Input routing wins over configured `plan.targetDir`; rules out config flips between surfaces.
- Inline and non-canonical seeds use configured defaults; rules out routing without a path signal.
- Git-disabled workflows retain external output; rules out adding no-commit artifacts to the repo.
- Reuse the existing target-dir override; rules out adding a duplicate flag or changing live config as the fix.

## Prerequisites

## Out of scope

- Relocating already-misrouted artifacts.
- Expanding Markdown lint coverage.

## Documentation updates

- `v2/docs/workflow-runner.md` — document preset output locations and target resolution precedence.
