---
name: review-roles-falsifiability-implement
---

# Implement review roles check ticked criteria for falsifiable evidence

## Problem

Implement review critic, adversary, and advocate prompts tell agents to review the spec and branch diff and emit verdicts but not what to check; plausible reviews pass while ticked acceptance criteria cite tests that would not fail against pre-change code.

## Behavior

Add one shared prompt fragment (generic wording: per-ticked-criterion falsifiability, passes-before-and-after as a finding, short defect-shape taxonomy, empty verdict when nothing real is found). Wire it into `implement.prompt.review.critic`, `.adversary`, and `.advocate` via declared assembly (`add:`), not duplicated prose in step bodies.

## Decisions

- Out of scope: pre-change source tool access; changing `BRANCH_DIFF` span; adjudicator prompt changes.
- Fragment lives on a lane no implement write step inherits automatically (same pattern as `implement.rules`), attached only to the three review roles.
- Pair falsifiability findings with the existing empty-verdict contract; rules out manufactured findings when nothing real is wrong.

## Acceptance criteria

- [ ] The shared review falsifiability fragment is registered and assembles into rendered implement review critic, adversary, and advocate prompts; pinned by the registered render-observer map entries for `prompts/implement/review-critic.md`, `review-adversary.md`, and `review-advocate.md`.
- [ ] `shared/prompts/review-implement.test.ts` test `implement review critic, adversary, and advocate renders include falsifiability mandate, defect-shape taxonomy, and empty-verdict-when-nothing-found` fails against the pre-change prompt corpus.
- [ ] `shared/prompts/review-falsifiability-fragment.test.ts` test `implement review falsifiability guidance is defined only on the shared fragment` fails when the same prose is copy-pasted into any of the three implement review step bodies.
- [ ] `shared/prompts/review-falsifiability-fragment.test.ts` test `review falsifiability fragment has no project-specific identifiers` pins the new fragment body (or an equivalent check scoped to that fragment id).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/prompts.md` — register the orphan-lane falsifiability fragment and `add:` assembly on implement review critic, adversary, and advocate (same pattern as `implement.rules`).
- `v2/docs/v1-behaviors.md` — implement review prompt content now includes falsifiability review checks.
- `v2/docs/workflow-runner.md` — what implement review roles are asked to check, not only I/O and rendering.

## Prerequisites

## Primary implementation surface

- Shared review falsifiability prompt fragment and implement review role prompts (`prompts/` entries rendered via `shared/prompts/review-implement.ts`)
