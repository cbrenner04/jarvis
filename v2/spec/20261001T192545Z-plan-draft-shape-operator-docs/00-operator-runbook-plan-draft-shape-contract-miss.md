# Operator runbook plan-draft shape contract_miss

## Problem

`v2/docs/operator-runbook.md` tells operators that only normalizer `failureReason` text (not `plan.draft.blocker` or bare `plan.draft.shape`) implies a spent in-loop `draft_contract_reprompt`, and it omits suffixed `plan.draft.shape:*` settlement strings, repairable-shape reprompt eligibility, and the hand flatten + `pipeline recover` path for a timestamp-named single child under `.jarvis-plan-stage/`.

## Decision ledger

- Extend the existing plan-draft `contract_miss` paragraph in `operator-runbook.md` in place; do not add a parallel shape-recovery section that repeats the existing `pipeline recover` checklist in the same file; rules out runbook drift from `pipeline-execution.md`.
- Name all four suffixed shape settlement reasons operators see on `jarvis run list` / `wait` / pipeline `failureDetail`: `plan.draft.shape:missing-dir`, `:no-index`, `:no-subspecs`, `:nested-roots=<n>`; rules out documenting only bare `plan.draft.shape` for structural misses.
- State that `:no-index`, `:no-subspecs`, and `:nested-roots=<n>` are repairable once in-loop (`draft_contract_reprompt` detail names flat staging: `intent.md`, `index.md`, ≥1 `NN-*.md` at the stage root) while bare `plan.draft.shape`, `:missing-dir`, and `plan.draft.blocker` are not; rules out conflating normalizer reprompt with shape reprompt or treating `:missing-dir` as repairable.
- Document operator hand fix when the valid tree sits under exactly one immediate child directory (e.g. `.jarvis-plan-stage/<timestamp>-<name>/`): promote `index.md`, `NN-*.md`, and `intent.md` to `.jarvis-plan-stage/` root, remove the emptied wrapper dir, then `jarvis pipeline recover` per the existing recover checklist; rules out implying the harness auto-flattens without recovery after a terminal `contract_miss`.

## Prerequisites

- Prerequisite specs `20261001T011651Z-plan-draft-shape-reasons-and-nested-child` and `20261001T150055Z-plan-draft-shape-contract-reprompt` are on the branch base (suffixed reasons, immediate-child acceptance, repairable-shape `draft_contract_reprompt`).

## Task checklist

- Revise the plan-draft `contract_miss` paragraph under `## Run list and wait` (and only adjacent cross-links needed for recover) so it distinguishes normalizer vs repairable-shape vs immediate-settlement shape misses, lists the four suffixes, and points operators at flatten-then-`pipeline recover` for a single nested immediate child when in-loop repair is exhausted or inapplicable.

## Acceptance criteria

- [x] `v2/docs/operator-runbook.md` plan-draft `contract_miss` prose names `plan.draft.shape:missing-dir`, `:no-index`, `:no-subspecs`, and `:nested-roots=<n>`, states which suffixes trigger one in-loop `draft_contract_reprompt` vs immediate settlement, and documents flattening a single immediate child directory to the staging root before `jarvis pipeline recover`.

## Documentation updates

- `v2/docs/operator-runbook.md` — plan-draft shape `contract_miss` operator semantics and nested-child hand recovery.
