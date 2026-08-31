# Retired prompt id invariant

## Problem

After [00](./00-retire-dead-registry-prompt-artifacts.md) and [01](./01-update-prompt-retirement-docs.md), the three retired registry ids must not reappear in the live corpus; substring grep would false-positive on live ids and test survivors.

## Decision ledger

- Match retired ids by whole-token registry-id equality — `plan.prompt.review` matches exactly that id, not `plan.prompt.review.adversary` or `plan.prompt.review-actuator`; same for `patch.prompt.review` vs `patch.prompt.review.*` and `patch.prompt.review-actuator` — rules out unsatisfiable substring grep.
- Corpus: `prompts/`, `shared/`, `v1/`, `v2/src/`, `v1/docs/`, `v2/docs/` — rules out ambiguous "outside git history" scope.
- Excluded: `v2/spec/**`, `@mutate` comment lines in `shared/prompts/review-profile.test.ts`, file-path strings that are not registry-id tokens — rules out archived-spec and mutation-fixture false positives.
- Survivor allowlist: `shared/prompts/review-profile.test.ts:46` (`@mutate` revert string `patch.prompt.review.critic`); `shared/prompts/review-profile.test.ts:66` (adjudicator domain-isolation `not.toContain("plan.prompt.review")`) — rules out forbidding required regression pins.

## Tasks

- Verify no exact-match occurrences of `plan.prompt.review`, `patch.prompt.review`, or `patch.prompt.review.critic` remain in the corpus per ledger match semantics and exclusions.

## Acceptance criteria

- [ ] Exact-id scan of the corpus finds no `plan.prompt.review`, `patch.prompt.review`, or `patch.prompt.review.critic` outside the survivor allowlist and exclusions; fails against pre-fix occurrences reachable in `shared/prompts/registry.test.ts`, `v1/test/prompts/rendered-snapshots.test.ts`, `shared/prompts/review-prompt-divergence.test.ts`, `prompts/registry.txt`, the three prompt files, `v1/docs/prompt-governance.md`, and `v2/docs/v1-behaviors.md`.

## Documentation updates

None.
