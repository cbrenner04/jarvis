---
name: plan-draft-structural-validation
---
# Plan draft structural validation

**Scope.** Extend `validateDraftOutput` before `plan: draft` commit.

## Problem

Plan structural rules (behavioral ACs, heading contracts, duplicate sections) live in prompts; harness only checks index/subspec existence and blocker ordering.

## Desired behavior

`validateDraftOutput` fails before `plan: draft` commit when draft output violates: exact `## Acceptance criteria` heading, duplicate-section warnings, coarse behavioral-vs-structural AC checks (via shared parser). Existing index/subspec/blocker ordering checks remain.

## Decisions

- Validation is harness-enforced before draft commit, not prompt-only guidance. Rules out relying on plan agent discipline for structural AC shape.
- Reuse shared spec parser for heading and AC extraction. Rules out a second plan-only parser diverging from patch.
- Coarse behavioral-vs-structural AC check is warning or fail per existing plan validation severity patterns — pin exact severity at implementation. Deferred to first consumer: fail vs warn on structural ACs — pin when validator wiring lands.
- Duplicate-section detection covers repeated canonical headings in one subspec. Rules out silently accepting duplicate `## Acceptance criteria` blocks.

## Acceptance signals

- Tests prove invalid heading variants fail validation before draft commit.
- Tests prove duplicate-section and structural-AC cases are caught per configured severity.
- Tests prove valid plan drafts still pass and commit.
- `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/plan-mode.md`: harness draft validation rules.
- `v2/docs/v1-behaviors.md`: plan draft structural gate behavior.

## Related: semantic AC grounding (from the D spec defect)

Structural validation here catches malformed ACs; it does not catch a *well-formed* AC that contradicts real behavior. The `shared-invocation-executor` spec shipped an AC asserting plan stops on a hard error while `plan-draft-hard-error-continue.test.ts` proved the opposite. Two grounding extensions belong with this work:

- **#2 (plan-draft):** flag a behavioral/preservation AC ("preserved", "unchanged", "stops", "continues") that cites no existing test or source anchor — enforcing the [[refactor-acs-cite-tests]] convention at draft time. Deterministically checkable (anchor present/absent); the deeper "does the cited test contradict the claim" stays agent discipline.
- **#3 (implementation-side, patch rules — pairs with this):** when satisfying an AC requires changing or deleting a *pre-existing* test, the implementation agent raises a `## Blocker` rather than editing the test. This is the backstop for defects that slip past draft validation.

## Out of scope

- Prerequisite automation for plan seeds.
- Changing plan prompt authoring instructions beyond alignment with validator.
- Patch-mode spec validation changes (the #3 implementation guardrail is a separate patch-rules change, noted above for sequencing).

## Prerequisites

- Single shared module parses patch spec index checklist, `## Blocker`, and `## Acceptance criteria` sections.
