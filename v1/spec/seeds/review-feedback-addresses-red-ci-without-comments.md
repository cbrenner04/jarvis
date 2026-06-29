# review-feedback addresses red CI without comments

## Problem

`jarvis1 review-feedback <worktree>` exits with "no open review comments" when a
PR is red only because CI failed. That leaves the operator without a Jarvis-owned
way to route deterministic CI failures back through an agent.

Observed on PR #821 for `test-hang-fixtures-self-clean`: CI failed in
`v1/test/idle-hang-fixtures.sandbox-unrunnable.test.ts`, but
`jarvis1 review-feedback 2026-06-29T08-45-01Z-test-hang-fixtures-self-clean`
reported no open review comments and did nothing.

## Desired behavior

When a PR has no review comments but has failing checks, `jarvis1 review-feedback`
should collect failing check names/log excerpts and run the feedback loop against
that CI failure context.

## Decisions

- Prefer extending `review-feedback` over adding a new command.
- Keep review-comment handling first when comments exist.
- Limit log context to failing check names and concise excerpts so feedback runs
  do not ingest entire CI logs.

## Documentation updates

- Update `v1/docs/operator-runbook.md` CI-only failure guidance once
  `review-feedback` can handle red checks without review comments.
