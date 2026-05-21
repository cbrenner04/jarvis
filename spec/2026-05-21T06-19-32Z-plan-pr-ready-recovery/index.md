# Plan PR Ready Recovery

Plan mode already has the normal "draft PR becomes ready after a successful
committed plan run" behavior. This tree is narrower: make that transition
recoverable and idempotent when a later successful committed
`jarvis plan --resume ...` run lands on a branch whose spec is already complete.

## Scope

- Committed plan mode only.
- Recovery is triggered only by a later successful committed resume run.
- Open draft PRs should recover, open ready PRs should no-op, and branches with
  no open PR should remain silent no-ops.
- Patch mode, background repair behavior, and non-open PR handling stay out of
  scope.

## Subspecs

- [ ] [00 - Recover plan PR readiness by branch PR state](./00-recover-plan-pr-readiness-by-state.md)
- [ ] [01 - Document committed-resume readiness recovery](./01-document-plan-ready-recovery.md)
