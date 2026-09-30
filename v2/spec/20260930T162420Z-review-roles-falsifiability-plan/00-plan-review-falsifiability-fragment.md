# Plan review falsifiability fragment

## Problem

Plan review critic, adversary, and advocate prompts emphasize editorial quality and harness-injected `## Unfalsifiable premises` findings but not whether ticked or proposed acceptance criteria cite evidence that would fail against pre-change code; plausible plan drafts still ship criteria that pass before and after the change.

## Decision ledger

- Reuse `implement.review.falsifiability` on `plan.prompt.review.critic`, `.adversary`, and `.advocate` via frontmatter `add:` only — rules out a plan-specific fragment id, a second normative copy in step bodies, or automatic inheritance on adjudicator/actuator/draft steps.
- Generalize the fragment's implement-only scope nouns in place (bump its `revision`): criteria are those ticked in a completed spec or proposed in a draft spec (unchecked included), and pre-change code is the branch diff context or, for a draft, the repository base — rules out verbatim reuse whose `ticked`/`completed spec`/`branch diff` wording no-ops on plan drafts, a plan-only note copied into three step bodies, and docs-only mapping the model never sees.
- Leave `plan.prompt.review.adjudicator`, `plan.prompt.review-actuator`, and `buildPlanReviewPassContext` premise/hollow-pin composition unchanged — rules out adjudicator/actuator prompt churn and duplicate harness detectors for per-criterion cited-evidence checks.
- Document how per-criterion falsifiability (cited test/path/verification vs pre-change code) differs from injected `## Unfalsifiable premises` (invariant/rule-out reachability on the repository base) — rules out operators and reviewers treating the two checks as redundant.
- Out of scope: pre-change source tool access; changing adversary premise bullet prose beyond assembly order already declared in `prompts/plan/review-adversary.md`.

## Tasks

- Reword `prompts/implement/review-falsifiability.md` per the ledger (stay generic: no project identifiers); update `FALSIFIABILITY_GUIDANCE_MARKERS` to the new wording.
- Add `add: [implement.review.falsifiability]` to `prompts/plan/review-critic.md`, `review-adversary.md`, and `review-advocate.md`; bump each step `revision`; do not duplicate fragment markers in step bodies.
- Extend `shared/prompts/review-falsifiability-fragment.test.ts` with `plan.prompt.review.critic`, `.adversary`, and `.advocate` in the copy-paste guard and add test `plan review falsifiability guidance is defined only on the shared fragment`.
- Add `shared/prompts/review-plan-falsifiability.test.ts` with test `plan review critic, adversary, and advocate renders include falsifiability mandate, defect-shape taxonomy, and empty-verdict-when-nothing-found` (fully rendered via `renderPlanReviewCriticPrompt` / `renderPlanReviewDebateRolePrompt`; reuse `FALSIFIABILITY_GUIDANCE_MARKERS` from `review-falsifiability-fragment.test.ts`; `## Review falsifiability` occurs exactly once per render); fails against the pre-change prompt corpus. Add test `plan review adjudicator, actuator, and draft renders omit falsifiability fragment` in the same file.
- Register render-observer map entries in `shared/prompts/render-observer-tests.ts`: add `shared/prompts/review-plan-falsifiability.test.ts` to observer lists for `prompts/plan/review-critic.md`, `review-adversary.md`, and `review-advocate.md`; add `shared/prompts/review-falsifiability-fragment.test.ts` to those three lists if not already present; map `prompts/implement/review-falsifiability.md` to `shared/prompts/review-plan-falsifiability.test.ts`.
- Update `v2/docs/prompts.md`, `v2/docs/workflow-runner.md`, `v2/docs/coding-standards.md`, and `v2/docs/v1-behaviors.md` per documentation updates below.

## Acceptance criteria

- [ ] The shared review falsifiability fragment assembles into rendered plan review critic, adversary, and advocate prompts; pinned by the registered render-observer map entries for `prompts/plan/review-critic.md`, `review-adversary.md`, and `review-advocate.md`.
- [ ] `shared/prompts/review-plan-falsifiability.test.ts` test `plan review critic, adversary, and advocate renders include falsifiability mandate, defect-shape taxonomy, and empty-verdict-when-nothing-found` fails against the pre-change prompt corpus.
- [ ] `shared/prompts/review-falsifiability-fragment.test.ts` test `plan review falsifiability guidance is defined only on the shared fragment` fails when the same prose is copy-pasted into any of the three plan review step bodies.
- [ ] `shared/prompts/review-plan-falsifiability.test.ts` test `plan review adjudicator, actuator, and draft renders omit falsifiability fragment` fails if `implement.review.falsifiability` is added to any of those steps.
- [ ] `shared/prompts/review-implement.test.ts` test `implement review critic, adversary, and advocate renders include falsifiability mandate, defect-shape taxonomy, and empty-verdict-when-nothing-found` stays green against the reworded fragment.
- [ ] `shared/prompts/review-plan-contract-preservation.test.ts` test `plan review role contract substrings preserved` stays green.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` and `bun run test:integration:v2` pass.
- [ ] `bun run test:shared` and `bun run test:integration:shared` pass.

## Documentation updates

- `v2/docs/prompts.md` — record `add: [implement.review.falsifiability]` on plan review critic, adversary, and advocate (same orphan-lane fragment as implement review); fragment scope covers draft and completed specs.
- `v2/docs/workflow-runner.md` — per-criterion falsifiability applies to proposed acceptance criteria in the staged plan spec (`CURRENT_SPEC`) judged against the repository base; on plan critic, falsifiability is acceptance-criteria / cited-evidence review, not product technical correctness (must not contradict preserved `Do not critique technical correctness` in `review-plan-contract-preservation.test.ts`); how that lens relates to harness-injected `## Unfalsifiable premises` so the two checks do not read as duplicates (otherwise aligned with implement review).
- `v2/docs/coding-standards.md` — falsifiable acceptance-criteria evidence as an authoring/review criterion (cited verification should fail against pre-change code; passes-before-and-after is a defect), alongside existing harness guidance.
- `v2/docs/v1-behaviors.md` — plan review prompt content now includes the shared falsifiability fragment on critic, adversary, and advocate.
