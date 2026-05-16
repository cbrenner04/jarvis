# Patch-mode models

Jarvis should choose explicit, cost-aware models for patch-mode agent runs.
Patch mode executes the active spec directly, so it should prefer competent
coding models with low reasoning overhead instead of premium deep-thinking
defaults.

## Subspecs

- [x] [01 — Patch model config](./01-patch-model-config.md)
- [x] [02 — Agent model flags](./02-agent-model-flags.md)
- [x] [03 — Documentation](./03-documentation.md)

## Conventions

- Run this spec with `jarvis run spec/2026-05-11-patch-mode-models/index.md`.
- Complete one subspec per iteration. Do not bundle.
- If the subspec is blocked, append a `## Blocker` section to that file and
  stop.
