# 03 — Operator documentation

## Problem

Cleanup eligibility, pipeline landing practice, and the v1-behaviors parity catalog do not describe subsumed plan-lane retirement, `Landed elsewhere`, or the dirty-refusal abandon hint.

## Work

- Update `v2/docs/operator-runbook.md` § Cleanup: eligibility gate — plan-lane subsumed authority (in-repo only), spec-dir resolution, `Landed elsewhere` report, dirty-refusal `--abandon` suggestion, dry-run preview for subsumed lanes.
- Update `v2/docs/operator-runbook.md` § Pipeline approve and reject, "Landing pipeline stage PRs" — closed in-repo plan PRs can retire on cleanup; external plan lanes excluded from subsumed authority.
- Update `v2/docs/v1-behaviors.md` with the eligibility and reporting change.

## Acceptance criteria

- [ ] `v2/docs/operator-runbook.md` documents plan-lane subsumed retirement, `Landed elsewhere`, and the merged dirty-refusal suggestion in the Cleanup section, and notes closed in-repo plan PR cleanup in the pipeline landing subsection.
- [ ] `v2/docs/v1-behaviors.md` records bulk cleanup plan-lane subsumed retirement and implement `Landed elsewhere` reporting.
- [ ] `bun run typecheck` passes; `bun run test:v2` and `bun run test:integration:v2` pass after subspecs 00–02.

## Documentation updates

- `v2/docs/operator-runbook.md`
- `v2/docs/v1-behaviors.md`
