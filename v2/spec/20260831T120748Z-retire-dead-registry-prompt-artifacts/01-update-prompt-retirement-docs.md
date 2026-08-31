# Update prompt retirement docs

## Problem

Operator and v1-parity docs still list the three retired prompts as registered-but-unwired artifacts.

## Decision ledger

- Drop the registered-but-unwired rows from `v1/docs/prompt-governance.md` — rules out docs claiming live registry membership for deleted artifacts.
- Remove `prompts/plan/review.md` from `v1/docs/plan-mode.md` prompt ownership — rules out operator-facing stale ownership listing.
- Record retirement in `v2/docs/v1-behaviors.md` — rules out silent baseline rot after a v1-visible prompt-registry change.
- Leave `v1/docs/agents.md` relocation inventory unchanged — historical path listing, not a live registry claim — rules out doc churn on archival inventory.

## Tasks

- Remove `plan.prompt.review`, `patch.prompt.review`, and `patch.prompt.review.critic` rows from `v1/docs/prompt-governance.md`.
- Remove `prompts/plan/review.md` from `v1/docs/plan-mode.md` prompt ownership.
- Update `v2/docs/v1-behaviors.md` to record `plan.prompt.review`, `patch.prompt.review`, and `patch.prompt.review.critic` are retired from the governed registry (not frozen-and-unwired).
- Run `bun run typecheck`.

## Acceptance criteria

- [x] `v1/docs/prompt-governance.md` no longer lists `plan.prompt.review`, `patch.prompt.review`, or `patch.prompt.review.critic`; fails against the pre-fix unwired rows reachable in that file.
- [x] `v1/docs/plan-mode.md` no longer lists `prompts/plan/review.md` in prompt ownership; fails against the pre-fix listing at line 109 in that file.
- [x] `v2/docs/v1-behaviors.md` records retirement of `plan.prompt.review`, `patch.prompt.review`, and `patch.prompt.review.critic` from the governed prompt registry; fails against the pre-fix frozen-and-unwired wording for `patch.prompt.review.critic` and the pre-fix absence of `plan.prompt.review` / `patch.prompt.review` retirement notes reachable in that file.

## Documentation updates

- `v1/docs/prompt-governance.md` — drop the registered-but-unwired rows for `plan.prompt.review`, `patch.prompt.review`, and `patch.prompt.review.critic`.
- `v1/docs/plan-mode.md` — drop `prompts/plan/review.md` from prompt ownership.
- `v2/docs/v1-behaviors.md` — record retirement of the three dead registry prompts.
