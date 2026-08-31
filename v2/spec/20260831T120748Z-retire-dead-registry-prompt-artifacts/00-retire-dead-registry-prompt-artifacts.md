# Retire dead registry prompt artifacts

## Problem

Three governed prompt artifacts have no production consumers: `plan.prompt.review` (`prompts/plan/review.md`), `patch.prompt.review` (`prompts/patch/review.md`), and frozen unwired `patch.prompt.review.critic` (`prompts/patch/review-critic.md`). Only `prompts/registry.txt`, registry load validation, and snapshot/divergence tests still reference them.

## Decision ledger

- Delete the three prompt files, their `prompts/registry.txt` lines, and test pins that exist only to guard them — rules out a green suite protecting dead artifacts.
- Drop only the vacuous `plan.prompt.review` revision assert in `v1/test/prompts/rendered-snapshots.test.ts` — rules out removing live `plan.prompt.review.*` snapshot pins (plan-draft enrichment).
- Trim `shared/prompts/review-prompt-divergence.test.ts` to adversary, advocate, and adjudicator only — rules out a divergence pin on a deleted critic artifact.
- Remove `patch.prompt.review.critic` critic-divergence coverage only — artifact is unwired; `implement.prompt.review.critic` divergence stays covered elsewhere — rules out deleting implement critic pins.
- Delete orphan `v1/test/fixtures/prompts/rendered/plan.prompt.review@r*.shared.txt` fixtures with no render path after the revision pin is removed — rules out dead fixture corpus (plan-draft enrichment).
- Partial early retirement of `[[prompt-corpus-dead-weight-sweep]]` — three of four dead prompt files; phantom `patch.prompt.review-actuator` and remaining sweep items stay for that future intent — rules out scope creep into actuator/consumer-less `promptIds` cleanup.

## Tasks

- Delete `prompts/plan/review.md`, `prompts/patch/review.md`, and `prompts/patch/review-critic.md`.
- Remove their `prompts/registry.txt` lines (`plan/review.md`, `patch/review.md`, `patch/review-critic.md`).
- Remove the `plan.prompt.review` `toContain` pin from `shared/prompts/registry.test.ts`.
- Extend `shared/prompts/registry.test.ts` retired-unavailable negative pins for `plan.prompt.review`, `patch.prompt.review`, and `patch.prompt.review.critic`.
- Remove the `plan.prompt.review` revision assertion from `v1/test/prompts/rendered-snapshots.test.ts`.
- Remove the `patch.prompt.review.critic` critic-divergence test from `shared/prompts/review-prompt-divergence.test.ts`.
- Delete orphan `v1/test/fixtures/prompts/rendered/plan.prompt.review@r*.shared.txt` fixtures.
- Run `bun run typecheck`, `bun run test:shared`, `bun run test:v1`, and `bun run test:v2`.

## Acceptance criteria

- [ ] `prompts/plan/review.md`, `prompts/patch/review.md`, and `prompts/patch/review-critic.md` are absent from disk; fails against the pre-fix files reachable on main.
- [ ] `shared/prompts/registry.test.ts` — `loadPromptRegistry()` stays green with the three retired artifacts absent from `prompts/registry.txt`, no longer expects `plan.prompt.review`, and asserts all three ids are unavailable; fails against the pre-fix `toContain("plan.prompt.review")` pin and pre-fix absence of `patch.prompt.review` / `patch.prompt.review.critic` negative pins reachable in that file.
- [ ] `v1/test/prompts/rendered-snapshots.test.ts` no longer asserts `plan.prompt.review` revision; fails against the pre-fix revision pin at line 68 in that file.
- [ ] `shared/prompts/review-prompt-divergence.test.ts` retains only adversary, advocate, and adjudicator divergence assertions; removing the unwired `patch.prompt.review.critic` test fails against the pre-fix critic-divergence pin in that file.
- [ ] No files match `v1/test/fixtures/prompts/rendered/plan.prompt.review@r*.shared.txt`; fails against the twelve pre-fix orphan fixtures reachable on main.

## Documentation updates

None — docs land in [01](./01-update-prompt-retirement-docs.md). Retired-id grep invariant lands in [02](./02-retired-prompt-id-invariant.md).
