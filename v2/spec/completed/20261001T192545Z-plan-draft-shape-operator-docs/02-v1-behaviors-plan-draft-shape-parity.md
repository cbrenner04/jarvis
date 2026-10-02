# v1-behaviors plan-draft shape parity

## Problem

`v2/docs/v1-behaviors.md` plan-draft bullets ~281 (draft output shape) and ~285 (draft-contract reprompt) already record suffixed `plan.draft.shape:*` reasons, immediate-child acceptance, and repairable versus immediate settlement; bullet ~284 still routes missing-tree settlement through bare `plan.draft.shape` and limits stage preservation to `.jarvis-plan-stage/index.md` or exactly one nested directory under `.jarvis-plan-stage/spec/`, contradicting `write.ts` and subspec 01.

## Decision ledger

- Reconcile only bullets that contradict subspec 01 / `write.ts` (shape routing, preservation, reprompt eligibility); do not restate the full layout matrix already owned by `write-behavior.md`; rules out a second canonical copy of the acceptance table.
- Stage-preservation prose must match the three `hasPreservablePlanDraftStageContent` branches: flat `index.md` at the stage root, exactly one nested byte-discovery candidate (`discoverNestedPlanDraftLayoutRoots`), or exactly one immediate child directory (`listImmediateChildStagingDirectories`, shape validity not required); rules out `spec/`-only preservation wording and conflating byte-discovery with the immediate-child-only preservation case.
- Shape contract-miss routing bullets must reference suffixed `failureReason` values where settlement is structural, reserving bare `plan.draft.shape` only for the legacy family label or reprompt-ineligible cases documented in code; rules out implying operators always see bare `plan.draft.shape` on missing-tree misses.

## Prerequisites

- Subspec 01 lands `write-behavior.md` contract text this subspec mirrors in the parity catalog.

## Task checklist

- Audit `v2/docs/v1-behaviors.md` plan-draft bullets (draft output shape, blocker routing, draft-contract reprompt) for bare `plan.draft.shape` / `spec/`-only preservation drift; patch bullets that disagree with implemented behavior.

## Acceptance criteria

- [x] `v2/docs/v1-behaviors.md` records suffixed `plan.draft.shape:*` settlement reasons and single immediate-child staging acceptance, and no plan-draft bullet asserts bare `plan.draft.shape` as the structural miss reason or `spec/<name>/` as the only nested preservation layout.

## Documentation updates

- `v2/docs/v1-behaviors.md` — plan-draft shape and staging parity with `write-behavior.md` and `write.ts`.
