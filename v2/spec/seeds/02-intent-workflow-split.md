# `intent` workflow — seed split only

Operator workflow: split one seed file into `ready-intents/*.md` via v2 write
loop. v1 parity path — no post-split review step.

## Scope

- `buildIntentWorkflowSteps`: flags `--seed` / `--seed-text`, `--target-dir`;
  resolve project from cwd; branch `intent/<slug>`; worktree under
  `~/.jarvis/worktrees`.
- Preset `intent`: one `write` step — `role: plan`, `promptId:
  intent.prompt.split`, staging dir artifact contract.
- Harness after split: port deterministic validation/repair from
  `v1/src/modes/plan/intent-split.ts` (frontmatter `name:`, `##
  Prerequisites`, filename slug).
- Land ready-intents under `<targetDir>/ready-intents/`; commit + draft PR via
  existing write-loop completion publish where `git: true`.
- Register preset on workflow launcher (seed 01).

## Decisions

- Preset name `intent`; no `review` step in this preset.
- Reuse shared `intent.prompt.split` prompt; do not fork v1 split prose.
- Single-behavior seeds emit one ready-intent — this workflow is one slice.

## Prerequisites

- Generic workflow launcher merged (seed 01).

## Out of scope

- `intent-reviewed` preset (seed 03).
- `jarvis1 intent` changes — v2-native path only.
- Inline NL routing.

## Reference

- `.scratch/v2-operator-workflows.md` — §`intent`, seed 02

## Documentation updates

- New operator doc section or extend `v2/docs/first-workflow-walkthrough.md`
  with intent workflow (split-only) happy path
