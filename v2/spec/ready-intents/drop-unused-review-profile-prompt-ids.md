---
name: drop-unused-review-profile-prompt-ids
---

# Drop unused `promptIds` from review profiles

## Problem

`ReviewPromptProfile` carries a `promptIds` table with zero production consumers. `implementReviewProfile.promptIds.actuator` pins phantom id `patch.prompt.review-actuator`, which names no registered artifact; any future `getById(profile.promptIds.actuator)` would throw for the implement domain only.

## Decision ledger

- Delete the unused `promptIds` field from `ReviewPromptProfile` rather than repairing the phantom id; rules out a latent `unknown prompt id` throw wired to config nothing reads.
- Update tests that construct or assert on `profile.promptIds`; rules out leaving compile-time references to the removed field.

## Acceptance criteria

- [ ] `ReviewPromptProfile` carries no `promptIds` field; `shared/prompts/review-profile.test.ts` fails against the pre-fix shape.
- [ ] `v2/src/execution/review-cycle.test.ts` and `v2/src/execution/review-debate.test.ts` stay green (v2 review dispatch behavior unchanged by the field removal).
- [ ] Grep finds no `patch.prompt.review-actuator` outside git history.
- [ ] `bun run typecheck`, `bun run test:shared`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — remove the partial-split note that `implementReviewProfile.promptIds.actuator` still pins `patch.prompt.review-actuator`.

## Prerequisites
