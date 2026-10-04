# Surface split operator docs

## Problem

Operators and plan agents still read symptom-based intent sizing in `v1/docs/spec-guidance.md` and
no durable v2 description of the intent split surface contract in `v2/docs/workflow-runner.md`.

## Decisions

- Document surface split only in the intent-listed durable homes — rules out duplicating the full
  contract in `v1/docs/intent-mode.md` or prompt-governance prose.
- Module-boundary surface vocabulary matches `ready-intents/plan-emits-one-subspec-per-module-boundary.md`
  (persistence, daemon request handling, CLI admission, execution loop, comparable seams) — rules out
  a separate intent-only boundary glossary.
- Update `v2/docs/v1-behaviors.md` intent fan-out bullet to surface-based splitting — rules out
  leaving the v1 parity catalog on behavior-level symptom slicing after the prompt change.

## Task checklist

- [ ] `v1/docs/spec-guidance.md`: authored intents split by touched module-boundary surface, not by
      symptom; keep existing subspec/intent/spec sizing boundaries intact.
- [ ] `v2/docs/workflow-runner.md`: intent split contract — one ready-intent per touched surface in
      dependency order; later intents list earlier-surface behaviors in `## Prerequisites`.
- [ ] `v2/docs/v1-behaviors.md`: revise the intent fan-out behavior bullet to match surface-based
      splitting.

## Acceptance criteria

- [x] `v1/docs/spec-guidance.md` states authored intents are split by touched module-boundary
      surface (not symptom) in the intent fan-out / sizing section.
- [x] `v2/docs/workflow-runner.md` documents the intent split contract: one ready-intent per touched
      surface in dependency order, with cross-surface prerequisite behaviors on later intents.
- [x] `v2/docs/v1-behaviors.md` records surface-based intent fan-out instead of behavior-symptom
      slicing only.

## Documentation updates

- `v1/docs/spec-guidance.md` — surface-based intent split.
- `v2/docs/workflow-runner.md` — intent split surface contract.
- `v2/docs/v1-behaviors.md` — v1/v2 intent fan-out parity line.
