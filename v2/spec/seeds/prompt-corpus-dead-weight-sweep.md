---
name: prompt-corpus-dead-weight-sweep
---

# Prompt corpus dead-weight sweep: four dead prompts, a phantom id, an unreachable branch

## Problem

The 2026-08-29 prompt review found dead surface in `prompts/` and its wiring:

- `prompts/plan/review.md` (`plan.prompt.review`): zero production references; only `shared/prompts/registry.test.ts:32` and `v1/test/prompts/rendered-snapshots.test.ts:68` touch it.
- `prompts/patch/review.md` (`patch.prompt.review`): registered but unwired, acknowledged in `v1/docs/prompt-governance.md:36`.
- `prompts/patch/review-critic.md` (`patch.prompt.review.critic`): frozen and unwired per `v2/docs/v1-behaviors.md:357`; only `shared/prompts/review-prompt-divergence.test.ts:24` reads it.
- `prompts/plan/name-only.md`: off-registry (no frontmatter), loaded only by `v1/src/modes/plan/name-only.ts:14`, whose sole entry point `runNameOnlyPhase` has zero importers (documented dormant in `v1/docs/agent-cli-failure-pipeline.md:43`).
- Phantom id: `implementReviewProfile.promptIds.actuator = "patch.prompt.review-actuator"` (`shared/prompts/review-profile.ts:74`) names no artifact. It never throws only because the `promptIds` tables have zero production consumers; any future `getById(profile.promptIds.actuator)` throws for the implement domain only.
- Unreachable branch: v1 plan-review's critic arm (`v1/src/modes/plan/review.ts:79`) — the role type at `v1/src/modes/review/run.ts:63` admits only adversary/advocate/adjudicator.

## Decisions

- Delete the four dead prompt files, their `registry.txt` lines, and the tests that exist only to pin them; test removals are intentional coverage of removed surface, inventoried in the PR. Rules out a green suite guarding dead artifacts.
- Delete the unused `promptIds` field from `ReviewPromptProfile` rather than repairing the phantom id — zero production consumers. Rules out a latent `unknown prompt id` throw wired to config nothing reads.
- Delete `runNameOnlyPhase` and `v1/src/modes/plan/name-only.ts` with the prompt file; v1 is maintenance-only and the export is documented dormant. Rules out keeping an unreachable v1 entry point for symmetry.
- Remove the unreachable critic branch and align v1 plan-review role handling with the actual role type. Rules out dead role plumbing surviving the sweep.
- `review-prompt-divergence.test.ts` keeps only the assertions whose subjects still exist (the three v1-live patch debate roles vs implement). Rules out the divergence pin failing on a deleted file.

## Acceptance criteria

- [ ] `prompts/registry.txt` and disk agree: none of the four files exist, `loadPromptRegistry()` stays green, pinned by the registry tests.
- [ ] Grep-level absence of `patch.prompt.review-actuator`, `plan.prompt.review` (exact id), `patch.prompt.review` (exact id), `patch.prompt.review.critic`, and `runNameOnlyPhase` outside git history, pinned.
- [ ] `ReviewPromptProfile` carries no `promptIds` field; v2 review dispatch behavior is unchanged, pinned by existing review-cycle tests.
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v1/docs/prompt-governance.md` — drop the "registered but unwired" row; `v2/docs/v1-behaviors.md:357` — record the retirement; `v1/docs/agent-cli-failure-pipeline.md:43` — drop the dormant-export note.
