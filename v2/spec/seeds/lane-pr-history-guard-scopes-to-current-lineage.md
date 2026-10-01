---
name: lane-pr-history-guard-scopes-to-current-lineage
---

# Lane PR history guard blocks fresh dispatches on a prior lineage's closed PR

## Problem

`findOrCreatePr` (`v2/src/execution/completion-publisher.ts:463-471`) returns `lane_pr_closed`/`lane_pr_merged` whenever the newest head+base PR is closed or merged, with no check that the PR belongs to the lane being published. A fresh dispatch that rematerializes a lane from base on a reused branch name (re-plan after a backlog reset, re-run of a ready-intent) inherits the old lineage's closed PR and never opens a draft. The guard (#4331) was meant to stop duplicate drafts on resume/republication of the same lane. No caller sets `allowLanePrRepublish`, so nothing bypasses it.

## Evidence

- 2026-10-01: `jarvis run workflow plan --ready-intent v2/spec/ready-intents/implement-run-records-agent-process-groups.md` (plan run `336edada`, review run `cb79ad42`) pushed `plan/implement-run-records-agent-process-groups` and opened no PR; the review run settled `completed`. Newest head+base PR was #4346 (`CLOSED` 14:04Z, head `e03213f`), an earlier unrelated plan lineage. `e03213f` is not an ancestor of the new tip `244c0e8`. Operator hand-opened #4364.
- The silent `completed` comes from `workflow-runner.ts:1761` dropping `publication.success.lanePrOutcome`; that settlement/visibility gap is owned by active spec `lane-pr-outcomes-settle-runs-and-stages` and ready-intent `daemon-projects-lane-pr-settlement`, not this seed.

## Decisions

- Closed/merged history blocks create only when it belongs to the current lineage: the newest PR's `headRefOid` equals or is an ancestor of the pushed tip, or of `leaseFromSha` when set (covers this run's rebase). Reuse the publisher's existing `isAncestor`.
- A newest closed/merged PR whose head is not in the lane's ancestry is foreign: create a fresh draft as if no history existed.
- Ancestry unreadable (head object unavailable after `git fetch origin pull/<n>/head`) is inconclusive: keep the existing guard outcome (fail closed), never create.
- Open-draft reuse, probe-failure handling, and the resume opt-in (`resume-admits-lane-pr-republish-opt-in`) are unchanged.

## Acceptance criteria

- [ ] `completion-publisher.test.ts`: newest `CLOSED` PR whose head is not an ancestor of the pushed tip → `gh pr create` runs and a new draft is confirmed; fails against current `findOrCreatePr`.
- [ ] Same file: newest `MERGED` PR on a foreign lineage → new draft created; fails against current code.
- [ ] Same file: newest `CLOSED` PR whose head is an ancestor of the pushed tip → no create, `lane_pr_closed` (existing behavior kept).
- [ ] Same file: newest `CLOSED` PR whose head is an ancestor of `leaseFromSha` but not of the rebased tip → no create, `lane_pr_closed`.
- [ ] Same file: ancestry check fails (head unreadable) → no create, guard outcome returned.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — head+base history guard applies only to the current lane lineage.
- `v2/docs/workflow-runner.md` — fresh dispatch on a reused branch opens a new draft despite a prior lineage's closed/merged PR.
- `v2/docs/v1-behaviors.md` — record the lineage-scoped guard.
