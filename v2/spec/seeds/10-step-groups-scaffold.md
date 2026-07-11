# Workflow step-groups and scaffolding helper

Authoring ergonomics: reusable step-group factories and a generator that stubs
new workflow presets from prompts + roles.

## Scope

- `v2/src/execution/step-groups/` (or co-located): shallow one-level factories —
  `intentSplitStep`, `planDraftStep`, `specReviewLight`, `specReviewDebate`,
  `implReview({ behavior, passes })`, `humanGate`.
- Scaffolding helper CLI or script: stub preset module + builder + registry
  entry + test skeleton (exact interface in spec).
- Refactor existing builders to use step-groups where it reduces duplication
  without behavior change.
- Config-vs-source validation check: project-enabled workflows vs required role
  bindings (minimal first version).

## Decisions

- No nested step-groups (one level only) — per `v2-architecture.md`.
- Helper generates source files; workflows stay in Jarvis source, not config.

## Prerequisites

- Intent, plan, and implement workflow presets merged (seeds 02–05, 07–09 as
  applicable).

## Out of scope

- `yolo` preset implementation (may use groups once this lands).
- YAML workflow authoring.

## Reference

- `.scratch/v2-operator-workflows.md` — Step-groups, seed 10

## Documentation updates

- `v2/docs/v2-architecture.md` — point to shipped helper path
- `v2/docs/workflow-runner.md` — step-groups section
