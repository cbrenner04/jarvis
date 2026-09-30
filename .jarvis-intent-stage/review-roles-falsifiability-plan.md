---
name: review-roles-falsifiability-plan
---

# Plan review roles check draft acceptance criteria for falsifiable evidence

## Problem

Plan review critic, adversary, and advocate prompts emphasize editorial quality and injected unfalsifiable-premise findings but not the falsifiability question for ticked or proposed acceptance criteria and their cited tests; plausible plan drafts still ship criteria that pass before and after the change.

## Behavior

Assemble the same shared review falsifiability fragment into `plan.prompt.review.critic`, `.adversary`, and `.advocate` alongside existing plan review layering and harness-injected premise context; do not duplicate fragment prose in step bodies.

## Decisions

- Reuse the fragment introduced for implement review; rules out a second normative copy for plan.
- Out of scope: adjudicator or review-actuator prompt changes beyond assembly order already declared; pre-change source tool access.

## Acceptance criteria

- [ ] The shared review falsifiability fragment assembles into rendered plan review critic, adversary, and advocate prompts; pinned by the registered render-observer map entries for `prompts/plan/review-critic.md`, `review-adversary.md`, and `review-advocate.md`.
- [ ] A render-observer test proves the rendered plan critic prompt states the per-criterion falsifiability mandate and the empty-verdict-when-nothing-found rule; it fails against the pre-change prompt corpus.
- [ ] A test proves the falsifiability guidance is not duplicated across the three plan review step sources (fragment remains the single body); it fails against a copy-pasted variant.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — what plan review roles are asked to check, aligned with implement review (if not fully covered by the implement intent).
- `v2/docs/coding-standards.md` — falsifiable evidence as a review criterion alongside existing authoring guidance.
- `v2/docs/v1-behaviors.md` — plan review prompt content change if not already recorded by the implement intent.

## Prerequisites

- A registered prompt fragment carries the generic per-criterion falsifiability mandate, defect-shape taxonomy, and empty-verdict-when-nothing-found rule without project-specific identifiers.
- Implement review critic, adversary, and advocate assemble that fragment with render-observer coverage on all three.

## Primary implementation surface

- Plan review role prompts and plan review render pins (`prompts/plan/review-*.md`, `shared/prompts/review-plan*.test.ts`)
