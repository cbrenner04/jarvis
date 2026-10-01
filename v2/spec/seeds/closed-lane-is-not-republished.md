---
name: closed-lane-is-not-republished
---

# Publication does not reopen a lane the operator closed or landed

## Problem

`findOrCreatePr` (`v2/src/execution/completion-publisher.ts`) looks only at open PRs for the head branch and base (`listMatchingOpenPrs`, `--state open`) and creates a fresh draft when none matches. A lane whose PR the operator closed, or whose work already merged, is republished as a new draft PR whenever its run publishes again (resume, restart recovery).

## Evidence

- 2026-09-30: operator closed lane PR #4286 (failure-usage; swept stale-main content) and landed a clean rebuild as #4301; ~25 min later `pipeline resume` of 2bbe5ceb re-drove run 614e1c4f, whose publication opened #4302 for the same branch.
- Prior session: #4243 duplicated merged #4191 and #4244 duplicated merged #4236 (`reports/20260930T110000Z-operator-structural-recovery.md`).

## Decisions

- Before creating a PR, list PRs for head+base with `--state all`. If the newest is `CLOSED` (unmerged) or `MERGED`, do not create; settle with a named outcome (`lane_pr_closed` / `lane_pr_merged`, carrying the PR number) and report it on the run and pipeline projections and the notification sink.
- `MERGED` settles as success (work landed); `CLOSED` settles as not-published, not `failed`, so it does not re-trigger recovery.
- Re-running a lane on a branch with closed history needs explicit operator opt-in (flag name decided at plan); never a silent re-create.
- An open draft still wins and is reused, unchanged. A failed list probe is inconclusive: do not create; settle failed with the probe cause.

## Acceptance criteria

- [ ] Test with fake `gh`: newest PR for the branch `CLOSED` → no `gh pr create`, outcome `lane_pr_closed` with the number; fails against the pre-fix `findOrCreatePr`.
- [ ] Test: newest `MERGED` → no create, outcome `lane_pr_merged`, settles success.
- [ ] Test: open draft alongside closed history → reused, no create.
- [ ] Test: with the opt-in, closed history → a new draft is created.
- [ ] Test: list probe throws → no create, failed with the probe cause.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — PR resolution consults closed/merged history; the opt-in.
- `v2/docs/pipeline-execution.md` — resumed lanes with a closed or merged PR settle instead of republishing.
- `v2/docs/operator-runbook.md` — closing a lane PR is final unless re-run with the opt-in.
