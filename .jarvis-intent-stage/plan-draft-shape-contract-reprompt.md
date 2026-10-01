---
name: plan-draft-shape-contract-reprompt
---

# Plan-draft shape misses (except missing dir) get one in-loop draft reprompt

`isEligibleDraftContractReprompt` excludes every `plan.draft.shape` miss, so fixable shape errors never trigger `draft_contract_reprompt` and `pipeline recover` repeats the same opaque settlement.

## Decisions

- Treat `plan.draft.shape:missing-dir` like today: immediate settlement, no reprompt.
- Treat `:no-index`, `:no-subspecs`, and `:nested-roots=<n>` as eligible for the existing one-shot `draft_contract_reprompt`, with detail naming the expected flat stage layout (`index.md`, `NN-*.md`, `intent.md` at the staging root).

## Acceptance criteria

- [ ] `v2/src/execution/write-loop.test.ts`: a plan-draft `:no-subspecs` contract miss emits exactly one `draft_contract_reprompt` before re-evaluation; fails against the current blanket `plan.draft.shape` exclusion.

## Primary implementation surface

- `v2/src/execution/write-loop.ts`

## Prerequisites

- Plan-draft shape validation emits distinct `plan.draft.shape:*` reasons for missing index, zero subspecs, and nested-root ambiguity (not bare `plan.draft.shape`).
- Staging resolution accepts and flattens exactly one immediate child directory of the stage root when that child holds a valid spec tree.
