# Drop unused `promptIds` from `ReviewPromptProfile`

## Problem

`ReviewPromptProfile` carries a `promptIds` table with zero production consumers — review dispatch reads `profile.render`, not pinned ids. `implementReviewProfile.promptIds.actuator` pins phantom id `patch.prompt.review-actuator`, which names no registered artifact; any future `getById(profile.promptIds.actuator)` would throw for the implement domain only.

## Surface

`shared/prompts/review-profile.ts` (type and domain specs); co-located `shared/prompts/review-profile.test.ts`; v2 execution tests that inline profile fixtures (`v2/src/execution/review-cycle.test.ts`, `v2/src/execution/review-debate.test.ts`); `v2/src/daemon/daemon-workflow-start.test.ts` (profile JSON round-trip); parity docs that still describe the phantom actuator pin (`v2/docs/v1-behaviors.md`, `v2/docs/workflow-runner.md`). No change to review renderers, dispatch, or registered prompt artifacts.

## Decision ledger

- Delete the unused `promptIds` field from `ReviewPromptProfile` and all domain profile specs rather than repairing the phantom `patch.prompt.review-actuator` id; rules out a latent `unknown prompt id` throw wired to config nothing reads.
- Update tests that construct or assert on `profile.promptIds` and remove the orphaned `@mutate` pin on `implementReviewProfile.promptIds.critic` in `review-profile.test.ts`; rules out compile-time references to the removed field and silent loss of the only named profile-pin guard.
- Implement-review critic-id regression coverage lives on render/registry surfaces (`review-implement.ts` constants and `review-implement.test.ts`), not profile pins; rules out re-homing critic-id assertions onto a deleted table.
- Rewrite `v2/docs/v1-behaviors.md` partial-split parity prose so it no longer mentions `promptIds` or `patch.prompt.review-actuator` and still accurately describes the v2-owned implement review split; rules out incoherent clause deletion that leaves stale partial-split framing.
- Trim `v2/docs/workflow-runner.md` prose that documents the removed `promptIds.actuator` pin; rules out leaving operator docs that describe a field that no longer exists.

## Task checklist

- Remove `promptIds` from the `ReviewPromptProfile` type and from `intentReviewProfile`, `planReviewProfile`, and `implementReviewProfile` in `shared/prompts/review-profile.ts`.
- Update `shared/prompts/review-profile.test.ts` to assert domain, verdict, and boundaries without `promptIds`; remove the `@mutate` pin and assertions on `implementReviewProfile.promptIds.critic`.
- Drop `promptIds` from inline profile fixtures in `v2/src/execution/review-cycle.test.ts` and `v2/src/execution/review-debate.test.ts`.
- Rewrite the `v2/docs/v1-behaviors.md` implement-review parity bullet so remaining prose describes the v2-owned four-artifact split and deferred `PATCH_REVIEW_*` rename without `promptIds` or `patch.prompt.review-actuator`.
- Update `v2/docs/workflow-runner.md` to remove the implement-review sentence clause that `implementReviewProfile`'s actuator id remains `patch.prompt.review-actuator`.
- Run `bun run typecheck`, `bun run test:v1`, `bun run test:integration:v1`, `bun run test:shared`, `bun run test:integration:shared`, `bun run test:v2`, and `bun run test:integration:v2`.

## Acceptance criteria

- [ ] `shared/prompts/review-profile.test.ts` fails against the pre-fix shape (references `profile.promptIds` that no longer exist on `ReviewPromptProfile`); after the change it passes with domain/verdict/boundary assertions only and no `@mutate` pin on removed `promptIds.critic`.
- [ ] `v2/src/execution/review-cycle.test.ts` stays green (review-cycle dispatch unchanged by the field removal).
- [ ] `v2/src/execution/review-debate.test.ts` stays green (review-debate dispatch unchanged by the field removal).
- [ ] `v2/src/daemon/daemon-workflow-start.test.ts` stays green (exported profile JSON round-trip unchanged by the field removal).
- [ ] Grep under `shared/`, `v2/src/`, and `v2/docs/` finds no `patch.prompt.review-actuator` (reachable on main in `shared/prompts/review-profile.ts`, `v2/src/execution/review-cycle.test.ts`, `v2/src/execution/review-debate.test.ts`, `v2/docs/v1-behaviors.md`, and `v2/docs/workflow-runner.md`).
- [ ] `v2/docs/v1-behaviors.md` implement-review parity bullet mentions neither `promptIds` nor `patch.prompt.review-actuator` and accurately describes the v2-owned implement review split.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v1` passes.
- [ ] `bun run test:integration:v1` passes.
- [ ] `bun run test:shared` passes.
- [ ] `bun run test:integration:shared` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/v1-behaviors.md` — rewrite the implement-review parity bullet so it no longer mentions `promptIds` or `patch.prompt.review-actuator`; retain accurate v2-owned `implement.prompt.review.*` four-artifact split and deferred `PATCH_REVIEW_*` rename prose.
- `v2/docs/workflow-runner.md` — remove the implement-review sentence clause that `implementReviewProfile`'s actuator id remains `patch.prompt.review-actuator`.
