---
name: plan-draft-shape-operator-docs
---

# Operator docs describe plan-draft shape suffixes and nested-child staging

Runbook and write-behavior still describe only bare `plan.draft.shape` and omit the timestamp-named nested-child layout operators may flatten by hand before `pipeline recover`.

## Acceptance criteria

- [x] `v2/docs/operator-runbook.md` plan-draft `contract_miss` paragraph names the `plan.draft.shape:*` suffixes and the hand fix (flatten to staging root, then `pipeline recover`).
- [x] `v2/docs/write-behavior.md` draft output shape section matches implemented accepted layouts (including single immediate child dir).
- [x] `v2/docs/v1-behaviors.md` records suffixed shape reasons and nested-child acceptance.

## Primary implementation surface

- `v2/docs/operator-runbook.md`
- `v2/docs/write-behavior.md`
- `v2/docs/v1-behaviors.md`

## Prerequisites

- Implement after `plan-draft-shape-contract-reprompt` (see `plan-draft-shape-reasons-and-nested-child` plan fan-out).
- Plan-draft shape validation emits distinct `plan.draft.shape:*` reasons for missing index, zero subspecs, and nested-root ambiguity (not bare `plan.draft.shape`).
- Staging resolution accepts and flattens exactly one immediate child directory of the stage root when that child holds a valid spec tree.
- One in-loop `draft_contract_reprompt` (flat-layout detail in `draft_contract_reprompt.detail`) applies to normalizer `failureReason` text and repairable shape suffixes `plan.draft.shape:no-index`, `plan.draft.shape:no-subspecs`, and `plan.draft.shape:nested-roots=<n>`; bare `plan.draft.shape`, `plan.draft.shape:missing-dir`, and `plan.draft.blocker` are excluded.
