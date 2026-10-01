---
name: terminal-publication-accepts-operator-merged-pr
---

# Terminal publication accepts an operator-merged PR

## Problem

Pipeline terminal publication (`v2/src/execution/terminal-publication.ts`) runs the ready gate and then `gh pr ready <n>` without checking the PR's state. When the operator already merged the implement PR, `gh pr ready` fails and the stage settles publication-failed although the work landed.

## Evidence

- Pipelines 998a665f and 66f666ad (2026-09-30): implement PR merged by the operator; terminal publication failed on `gh pr ready`.
- Prior session (`reports/20260930T110000Z-operator-structural-recovery.md` friction; brief § Open observations): `ready` after an operator hand-merge failed `exit unknown`.

## Decisions

- Before the ready gate, read the PR's state by number (`gh pr view <n> --json state,mergedAt`). `MERGED` is success: skip the ready gate, the flip, and any `merge` action; record terminal publication evidence with the merged state so projections and notifications report "merged by operator", not failure.
- `CLOSED` (unmerged) is not success: settle publication-failed with a named cause (`pr_closed`); never reopen.
- A failed state probe is inconclusive and falls through to today's path, unchanged.
- No change for `leave-draft`.

## Acceptance criteria

- [ ] Test with fake `gh`: state `MERGED` → publication succeeds, ready gate and `gh pr ready` are not invoked, evidence records merged; fails against the pre-fix path.
- [ ] Test: `CLOSED` → failure with cause `pr_closed`, no `gh pr ready`.
- [ ] Test: state probe throws → ready gate and flip run as before.
- [ ] Test: terminal action `merge` with a `MERGED` PR does not call `gh pr merge`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — terminal publication treats an operator-merged PR as success; a closed PR is `pr_closed`.
- `v2/docs/operator-runbook.md` — hand-merging an implement PR before terminal publication is safe.
