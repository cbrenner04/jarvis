---
name: runbook-review-feedback-ci-only
---

# Runbook steers CI-only failures through `review-feedback`

## Problem

`v1/docs/operator-runbook.md` tells operators that `review-feedback` stalls on CI-only failures and to abandon/re-run after unproductive rounds. Once `review-feedback` can act on red checks without review comments, that guidance is wrong and hides the Jarvis-owned fix path.

## Desired behavior

Update the CI-only failure guidance in `v1/docs/operator-runbook.md` to steer operators through `jarvis1 review-feedback <worktree>` when the PR has failing checks but no open review comments. Remove or narrow abandon/re-run stopgap text that assumes `review-feedback` cannot see CI failures. Keep scoped-abandon guidance for cases where feedback rounds are still unproductive.

## Decisions

- `v1/docs/operator-runbook.md` is the operator durable home — rules out documenting the workflow only in `v2/docs/v1-behaviors.md`.
- Edit only the CI-only failure recovery section — rules out rewriting unrelated triage, merge, or cleanup guidance.

## Documentation updates

- `v1/docs/operator-runbook.md` — CI-only failure path via `review-feedback`; retire stale stall/abandon-first wording.

## Prerequisites

- `jarvis1 review-feedback` runs the feedback loop from failing CI check context when the PR has no open review comments
