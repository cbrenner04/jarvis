# Record shape reasons and nested-child acceptance in v1-behaviors

## Problem

The v1 parity catalog in `v2/docs/v1-behaviors.md` still describes bare `plan.draft.shape` for missing-tree shape misses and documents nested staging only under `spec/<name>/` and repo-relative prefixes, not a single immediate child directory at the stage root.

## Decision ledger

- Update only `v2/docs/v1-behaviors.md` in this subspec; `write-behavior.md` and `operator-runbook.md` stay with intent `plan-draft-shape-operator-docs`; rules out duplicating operator runbook edits here.
- Subspec 02 owns intent-level harness gates after implementation subspecs land.

## Prerequisites

- Subspecs 00 and 01 land suffixed shape reasons, compose fallback, and immediate-child staging acceptance in `write.ts`.

## Task checklist

- Update the draft output shape contract bullet in `v2/docs/v1-behaviors.md`: list suffixed settlement reasons `plan.draft.shape:missing-dir`, `:no-index`, `:no-subspecs`, `:nested-roots=<n>` (pipeline `failureDetail` / run list show the full string); document acceptance of exactly one immediate child directory at `.jarvis-plan-stage/` containing `index.md` and `NN-*.md`, in addition to existing flat, `spec/<name>/`, and repo-relative layouts.

## Acceptance criteria

- [x] `v2/docs/v1-behaviors.md` records suffixed `plan.draft.shape:*` settlement reasons and single immediate-child staging acceptance aligned with subspecs 00–01.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/v1-behaviors.md` — suffixed shape failure reasons and immediate-child nested staging acceptance.
