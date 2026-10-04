---
name: retire-dead-registry-prompt-artifacts
---

# Retire dead registered prompt artifacts

## Problem

Three governed prompt artifacts have no production consumers: `plan.prompt.review` (`prompts/plan/review.md`), `patch.prompt.review` (`prompts/patch/review.md`), and frozen unwired `patch.prompt.review.critic` (`prompts/patch/review-critic.md`). Only registry and snapshot tests still reference them.

## Decision ledger

- Delete the three prompt files, their `registry.txt` lines, and tests that exist only to pin them; rules out a green suite guarding dead artifacts.
- Trim `shared/prompts/review-prompt-divergence.test.ts` to the three v1-live patch debate roles versus implement; rules out the divergence pin failing on a deleted critic artifact.

## Acceptance criteria

- [ ] `prompts/registry.txt` and disk agree: `prompts/plan/review.md`, `prompts/patch/review.md`, and `prompts/patch/review-critic.md` are absent and `loadPromptRegistry()` stays green, pinned by registry load tests.
- [ ] `shared/prompts/registry.test.ts` no longer expects `plan.prompt.review`; it fails against the pre-fix registry pin.
- [ ] `v1/test/prompts/rendered-snapshots.test.ts` no longer snapshots `plan.prompt.review`; it fails against the pre-fix snapshot pin.
- [ ] `shared/prompts/review-prompt-divergence.test.ts` retains only adversary, advocate, and adjudicator divergence assertions; removing the unwired `patch.prompt.review.critic` assertion fails against the pre-fix test.
- [ ] Grep finds no `plan.prompt.review` (exact id), `patch.prompt.review` (exact id), or `patch.prompt.review.critic` outside git history.
- [ ] `bun run typecheck`, `bun run test:shared`, `bun run test:v1`, and `bun run test:v2` pass.

## Documentation updates

- `v1/docs/prompt-governance.md` — drop the registered-but-unwired rows for `plan.prompt.review`, `patch.prompt.review`, and `patch.prompt.review.critic`.
- `v2/docs/v1-behaviors.md` — record retirement of the three dead registry prompts.

## Prerequisites
