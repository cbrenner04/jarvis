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

## Out of scope

- Prerequisite automation for plan seeds.
- Changing plan prompt authoring instructions beyond alignment with validator.
- Patch-mode spec validation changes.

## Prerequisites

- Single shared module parses patch spec index checklist, `## Blocker`, and `## Acceptance criteria` sections.
