---
name: implement-publication-reuses-closed-same-branch-pr
---

# Publication ready-flip targets a closed same-branch PR instead of opening a fresh draft

## Problem

When `implement` re-runs on a spec branch whose *earlier* subspec already merged a PR on that same branch, the completion-publication step resolves that stale merged/closed PR and tries to mark it "ready for review" instead of opening a new draft. It fails terminally with `ready_flip_failed`: `Pull request cbrenner04/jarvis#<n> is closed. Only draft pull requests can be marked as "ready for review"`. The impl, review, and mutation gates all passed; only publication failed, stranding a complete, green branch with no PR.

## Evidence

- 2026-08-29, P0 deferred-settlement spec (`#3036`). Subspec 00 landed as PR **#3054** on branch `20260829T023500Z-deferred-settlement-resume-preserves-pr-evidence`. Subspec 01 re-ran `implement` on the same branch (rematerialized from `main`); publication run `949a26cb` settled `completed` with `loopOutcomeKind: ready_flip_failed`, `nextAction: stop`, trying to ready the already-merged **#3054**. Operator hand-published as **#3069**.
- Multi-subspec specs route every subspec through the same `<timestamp>-<name>` branch, so any spec past its first subspec is exposed: subspec N's publication sees subspec N-1's merged same-branch PR.

## Decisions

- Publication resolves the PR to flip by open/draft state, not by most-recent match: a branch whose only matching PR is merged or closed opens a **fresh draft** rather than attempting a `gh pr ready` on the closed one. Rules out ready-flipping a non-open PR.
- Diagnose the impossible flip before issuing it: if the resolved PR is not open+draft, either open a new draft (no open PR exists) or fail with a named, actionable error (an unexpected open non-draft) — never the raw GitHub `Only draft pull requests…` string as a terminal `ready_flip_failed`.
- Scope to the publication PR-resolution seam; do not change branch reuse or rematerialization.

## Acceptance criteria

- [ ] A publication whose branch has exactly one matching PR that is merged/closed opens a new draft PR and readies it, pinned by a test that fails against the current resolve-most-recent behavior.
- [ ] A publication whose branch has one open draft PR still reuses and readies it (no regression), pinned by a test.
- [ ] The terminal `ready_flip_failed` path can no longer be reached by a closed same-branch PR; any residual not-open-draft case fails with a named actionable error, not the raw GitHub message.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — remove the stopgap gotcha bullet for this defect when shipped; note that multi-subspec publication opens a fresh draft per subspec.
- `v2/docs/workflow-runner.md` — publication PR resolution keys off open/draft state.
