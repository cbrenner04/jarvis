# V2-owned implement review prompts

v2 implement review and v1 patch review share `patch.prompt.review.*` ids while
supplying different `BRANCH_DIFF` payloads. v1 prose must stay summary-only;
v2 needs merge-base unified-diff prose. Split ids so each engine renders its own
artifacts.

## Decisions

- New ids `implement.prompt.review.{critic,adversary,advocate,adjudicator}` in `prompts/implement/review-*.md` — rules out reusing `patch.prompt.review.*` for v2 or revision-based registry selection.
- `behavior: patch` on new artifacts — rules out inventing `behavior: implement` before any implement-scoped fragments exist.
- v1 `prompts/patch/review-{critic,adversary,advocate,adjudicator}.md` and `patch.prompt.review.*` ids unchanged — rules out editing v1 render path or `getBranchDiffSummary`.
- All four v2 roles split (critic included) — rules out leaving critic on `patch.prompt.review.critic` while debate roles move.
- v2 debate prose corrected to merge-base unified-diff wording (match critic section pattern) — rules out summary-only section headings on v2 debate roles.
- `prompts/patch/review.md` (`patch.prompt.review`) untouched — no consumer.
- Intentional duplication; v1 prompts frozen for maintenance-only engine.

## Task checklist

- [ ] Add four governed prompt artifacts under `prompts/implement/` and register them in `prompts/registry.txt`.
- [ ] Point v2 implement review render (`shared/prompts/review-implement.ts`, `implementReviewProfile` in `shared/prompts/review-profile.ts`, and any step builders that pin prompt ids) at the new ids.
- [ ] Add registry manifest coverage and a cross-engine render divergence test.
- [ ] Update `v2/docs/workflow-runner.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] v2 implement review renders `implement.prompt.review.{critic,adversary,advocate,adjudicator}`; v1 patch review still renders `patch.prompt.review.{adversary,advocate,adjudicator}` via `v1/src/modes/patch/prompt.ts`.
- [ ] All four v2 role prompts describe `BRANCH_DIFF` as merge-base unified diff; no v2 implement review prompt contains `not a unified diff`.
- [ ] `v1/test/prompts/rendered-snapshots.test.ts` stays green (v1 rendered review prompts byte-identical to before).
- [ ] `shared/prompts/review-implement.test.ts` asserts v1 `buildReviewPrompt` adversary prose and v2 `renderReviewDebateRolePrompt` adversary prose diverge on branch-diff description; it fails against the pre-split code.
- [ ] `shared/prompts/registry.test.ts` fails when any `implement.prompt.review.{critic,adversary,advocate,adjudicator}` id is missing from the loaded registry.
- [ ] `shared/prompts/review-implement.test.ts` fails when `PATCH_REVIEW_DEBATE_ROLE_PROMPT_IDS.adversary` is reverted to `patch.prompt.review.adversary` (guard inversion; `@mutate` on the adversary id constant).

## Documentation updates

- `v2/docs/workflow-runner.md` — v2 implement review owns `implement.prompt.review.*` artifacts.
- `v2/docs/v1-behaviors.md` — record prompt-id split; v1 `patch.prompt.review.*` prompts frozen (summary-only `BRANCH_DIFF` prose).
