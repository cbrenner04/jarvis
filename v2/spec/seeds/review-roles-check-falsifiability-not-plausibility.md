---
name: review-roles-check-falsifiability-not-plausibility
---

# Review roles are told to review, not what makes a review find anything

## Problem

`prompts/implement/review-critic.md` is 38 lines and, stripped of placeholders and formatting rules, says: review the completed spec and branch diff, emit an outcome verdict, do not edit. The adversary and advocate prompts are the same size and shape. None of them says what to *check*. In particular none asks the one question that separates a review that finds things from a review that reads plausibly:

> For each acceptance criterion the agent ticked, would the test it cites actually fail against the pre-change code?

A test that passes before and after the change proves nothing, and a ticked criterion citing one is how a defect ships with full mechanical evidence behind it. This repo has shipped that repeatedly — a criterion whose test picked the one phrasing that still worked while the refusal it claimed to cover was unreachable; a criterion satisfied literally while the decision it existed to enforce was defeated one layer away.

Independent review with an explicit checklist found a real defect in **4 of 4** autonomously-written changes on 2026-09-11, each of which had green CI, fully ticked criteria, and (where applicable) passing mutation verification. Three of the four were visible in the branch diff alone, which is exactly what these roles already receive:

- a `find` predicate whose two arms were folded into one, silently losing an ordering preference that only shows up with more than one input row;
- a test double that mirrored part of a production rule instead of enforcing it, so a regression in the production writer kept the suite green;
- a validation-only code path writing a temp copy into the arbitrary target project it was validating.

The fourth — a value persisted correctly while its only consumer ignored it — required reading an unchanged file, so it is out of reach for a diff-only role and is not what this seed claims to fix.

## Decisions

- The shared review guidance gains a falsifiability mandate: for every ticked acceptance criterion, state whether the cited evidence would fail against the pre-change code, and treat "passes before and after" as a finding in itself. It is phrased over acceptance criteria and diffs generally, with no repo-specific vocabulary.
- It also gains a short, generic taxonomy of defect shapes that survive mechanical gates, as things to look for rather than a checklist to recite: a guard that fails open where the spec says fail closed; a branch made unreachable by an earlier short-circuit while a criterion claims to cover it; a value computed or persisted correctly and then ignored by the code that consumes it; an expectation that re-derives the production rule instead of stating the intended result independently; a predicate correct for one input and wrong for several, where fixtures supply one.
- Explicitly paired with the existing empty-verdict contract: a review that finds nothing real must still emit an empty verdict. Rules out trading silent misses for manufactured findings, which costs an actuator pass each.
- The guidance lives in one shared fragment consumed by critic, adversary, and advocate rather than being pasted into three prompts — the fragment policy already exists for this.
- Out of scope: giving review roles tool access to read pre-change source. That is a capability change, not a prompt change, and it is what the fourth defect above would need. Pin it separately if the diff-only ceiling proves too low.
- Out of scope: changing what the roles are handed (`BRANCH_DIFF` already spans merge-base to HEAD, which is the correct comparison).

## Acceptance criteria

- [ ] The shared review guidance fragment exists and is rendered into the critic, adversary, and advocate prompts; pinned by the registered render-observer tests for all three.
- [ ] A render-observer test proves the rendered critic prompt states the per-criterion falsifiability mandate and the empty-verdict-when-nothing-found rule; it fails against the pre-change prompt corpus.
- [ ] A test proves the guidance is defined once and not duplicated across the three prompt sources; it fails against a copy-pasted variant.
- [ ] The prompt corpus contains no project-specific identifiers (no repo, module, PR, or issue references) in the new guidance; pinned by the existing prompt-corpus checks or a new one.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — what the review roles are asked to check, not only their I/O contract.
- `v2/docs/coding-standards.md` — falsifiable evidence as a review criterion, alongside the existing authoring guidance.
- `v2/docs/v1-behaviors.md` — record the changed review prompt content.
