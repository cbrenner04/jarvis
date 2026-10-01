---
name: plan-draft-shape-contract-reprompt
---

# Plan-draft shape misses (except missing dir) get one in-loop draft reprompt

`isEligibleDraftContractReprompt` excludes only bare `failureReason === "plan.draft.shape"`; suffixed shape misses are eligible today by accident and reprompt detail does not name the flat layout. After suffixes land, eligibility must be explicit: prefix `plan.draft.shape` with `:missing-dir` carved out.

## Decisions

- Treat `plan.draft.shape:missing-dir` like today: immediate settlement, no reprompt.
- Treat `:no-index`, `:no-subspecs`, and `:nested-roots=<n>` as eligible for the existing one-shot `draft_contract_reprompt`, with detail naming the expected flat stage layout (`index.md`, `NN-*.md`, `intent.md` at the staging root).
- Replace bare-reason equality in `isEligibleDraftContractReprompt` with shape-family prefix match and an explicit ineligible list (`:missing-dir` only).

## Acceptance criteria

- [ ] `v2/src/execution/write-loop.test.ts`: a plan-draft `:no-subspecs` contract miss emits exactly one `draft_contract_reprompt` before re-evaluation whose detail names the flat staging layout; fails against the pre-fix bare `plan.draft.shape` exclusion.
- [ ] Same file: a plan-draft `:missing-dir` contract miss emits zero `draft_contract_reprompt` events; fails if a reprompt is emitted once suffixes exist.
- [ ] `v2/docs/v1-behaviors.md` records which `plan.draft.shape:*` suffixes get one in-loop `draft_contract_reprompt` and that `:missing-dir` does not.

## Primary implementation surface

- `v2/src/execution/write-loop.ts`

## Prerequisites

- Implement after `plan-draft-shape-reasons-and-nested-child` (see that intent's plan fan-out).
- Plan-draft shape validation emits distinct `plan.draft.shape:*` reasons for missing index, zero subspecs, and nested-root ambiguity (not bare `plan.draft.shape`).
- Staging resolution accepts and flattens exactly one immediate child directory of the stage root when that child holds a valid spec tree.
