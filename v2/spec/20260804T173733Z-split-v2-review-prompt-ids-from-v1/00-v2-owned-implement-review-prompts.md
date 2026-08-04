# V2-owned implement review prompts

v2 implement review and v1 patch review share `patch.prompt.review.*` ids while
supplying different `BRANCH_DIFF` payloads. v1 prose must stay summary-only;
v2 needs merge-base unified-diff prose. Split ids so each engine renders its own
artifacts.

## Prerequisites

v2 implement review already supplies merge-base unified diff as `BRANCH_DIFF`
(landed spec `20260721T195333Z-implement-review-supplies-unified-diff`).

## Decisions

- New ids `implement.prompt.review.{critic,adversary,advocate,adjudicator}` in `prompts/implement/review-*.md` — rules out reusing `patch.prompt.review.*` for v2 or revision-based registry selection.
- `behavior: patch` on new artifacts — rules out inventing `behavior: implement` before any implement-scoped fragments exist.
- `revision: 1` on all four new artifacts — rules out inheriting `revision: 2` from patch copies.
- Heading `# Implement Mode — Review: {Critic|Adversary|Advocate|Adjudicator}` on all four artifacts — rules out retaining `Patch Mode` headings on implement-owned files.
- Critic copies `prompts/patch/review-critic.md` body with heading/id swap only (already has `## Branch diff` merge-base prose).
- Debate roles copy respective `prompts/patch/review-{adversary,advocate,adjudicator}.md` bodies but replace `## Branch change summary` and its summary-only paragraph with critic's `## Branch diff` section (merge-base unified-diff wording).
- v1 `prompts/patch/review-{critic,adversary,advocate,adjudicator}.md` and `patch.prompt.review.*` ids unchanged — rules out editing v1 render path or `getBranchDiffSummary`.
- All four v2 roles split (critic included) — rules out leaving critic on `patch.prompt.review.critic` while debate roles move.
- `prompts/patch/review.md` (`patch.prompt.review`) untouched — no consumer.
- Intentional duplication; v1 prompts frozen for maintenance-only engine.
- Post-split governance: `patch.prompt.review.critic` frozen and unwired; `patch.prompt.review.*` debate artifacts stay summary-worded (critic already unified-diff — intentional patch-family inconsistency); `implementReviewProfile` keeps `patch.prompt.review-actuator`; shared API names (`PATCH_REVIEW_*`, `renderPatchReviewCriticPrompt`) unchanged this spec — rename deferred.

## Task checklist

- [ ] Add four governed prompt artifacts under `prompts/implement/` (`revision: 1`, implement headings, critic/debate copy rules above) and register them in `prompts/registry.txt`.
- [ ] Point v2 implement review render at new ids: `PATCH_REVIEW_CRITIC_PROMPT_ID` and `PATCH_REVIEW_DEBATE_ROLE_PROMPT_IDS` in `shared/prompts/review-implement.ts`, and `implementReviewProfile.promptIds` in `shared/prompts/review-profile.ts` (separate pin surfaces).
- [ ] Update v2 tests that hardcode `patch.prompt.review.*` for implement review: `implement-workflow-steps.test.ts`, `workflow-runner.test.ts`, `review-debate.test.ts`, `review-cycle.test.ts`, `review-profile.test.ts`.
- [ ] Add registry manifest coverage, cross-engine registry-body divergence test, and all-four-role prose verification in `shared/prompts/`.
- [ ] Update `v2/docs/workflow-runner.md`, `v2/docs/write-behavior.md`, and `v2/docs/v1-behaviors.md` (governance state above); optionally `v1/docs/prompt-governance.md`.

## Acceptance criteria

- [x] v2 implement review renders `implement.prompt.review.{critic,adversary,advocate,adjudicator}`; v1 patch review still renders `patch.prompt.review.{adversary,advocate,adjudicator}` via `v1/src/modes/patch/prompt.ts`.
- [x] `shared/prompts/review-implement.test.ts` renders critic, adversary, advocate, and adjudicator and asserts each contains merge-base unified-diff prose with no `not a unified diff`; fails against pre-split code on debate roles.
- [x] `shared/prompts/review-prompt-divergence.test.ts` loads `patch.prompt.review.adversary` and `implement.prompt.review.adversary` registry bodies and asserts branch-diff section prose diverges (summary-only vs merge-base unified diff); fails against pre-split code when v2 still pointed at patch id.
- [x] `v1/test/prompts/rendered-snapshots.test.ts` stays green (v1 rendered review prompts byte-identical to before).
- [x] `shared/prompts/registry.test.ts` fails when any `implement.prompt.review.{critic,adversary,advocate,adjudicator}` id is missing from the loaded registry.
- [x] `shared/prompts/review-implement.test.ts` fails when `PATCH_REVIEW_DEBATE_ROLE_PROMPT_IDS.adversary` is reverted to `patch.prompt.review.adversary` (`@mutate` on the adversary id constant).
- [x] `shared/prompts/review-profile.test.ts` fails when `implementReviewProfile` `critic` id is reverted to `patch.prompt.review.critic` (`@mutate` on the profile critic id pin).
- [x] `v2/docs/workflow-runner.md` and `v2/docs/write-behavior.md` no longer describe `patch.prompt.review.*` as the active v2 implement-review id set.

## Documentation updates

- `v2/docs/workflow-runner.md` — v2 implement review owns `implement.prompt.review.*` artifacts; `patch.prompt.review-actuator` unchanged.
- `v2/docs/write-behavior.md` — same id-set correction as workflow-runner.
- `v2/docs/v1-behaviors.md` — prompt-id split; v1 `patch.prompt.review.*` frozen (summary-only debate prose); `patch.prompt.review.critic` frozen and unwired; partial split (`review-actuator` stays patch); shared `PATCH_REVIEW_*` names deferred.
- `v1/docs/prompt-governance.md` (optional) — record unwired `patch.prompt.review.critic` and frozen patch-family debate prose.

## Blocker

Artifact contract check failed: Hollow mutation checkpoints (the named mutation left the scoped suite green):
- no @mutate directive linked to this criterion; add // @mutate <path> "<original>" -> "<replacement>" on the named pin
- no @mutate directive linked to this criterion; add // @mutate <path> "<original>" -> "<replacement>" on the named pin
