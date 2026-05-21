# Plan PR Ready Recovery

Plan mode already attempts to flip committed plan PRs from draft to ready once
all scripted phases succeed. The gap in this tree is recovery and idempotence
when a later successful committed `jarvis plan --resume ...` run lands on a
branch whose spec is complete but whose open PR is still draft because an
earlier ready transition failed, was skipped, or did not stick.

This work stays scoped to committed plan mode. It does not introduce a
background repair path, does not broaden behavior to patch mode, and does not
change the existing rule that readiness only happens after a successful plan
completion path.

## Decisions

- Model the open PR for the plan branch with explicit branch-scoped states
  rather than the current binary "exists / does not exist" seam. The readiness
  path needs to distinguish `none`, `draft`, and `ready` before it decides
  whether to run `bun run ready` or `gh pr ready`.
- Keep the current best-effort boundary in `safeMarkPlanPrReady(...)`. A later
  successful committed resume may recover a missed draft-to-ready transition,
  but a real readiness failure still warns and leaves the PR draft.
- Treat already-ready PRs as a full no-op. Recovery should skip both the ready
  gate and the GitHub transition rather than trying `gh pr ready` and
  suppressing CLI wording.
- Keep non-open PRs out of scope. Closed or merged PRs on the same branch still
  behave like "no open PR" for this helper path.

## Subspecs

- [ ] [00 - Recover plan PR readiness by branch PR state](./00-recover-plan-pr-readiness-by-state.md)
- [ ] [01 - Document committed-resume readiness recovery](./01-document-plan-ready-recovery.md)
