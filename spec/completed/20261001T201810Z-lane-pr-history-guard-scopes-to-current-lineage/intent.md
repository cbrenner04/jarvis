---
name: lane-pr-history-guard-scopes-to-current-lineage
---

# Lane PR history guard scopes closed/merged blocking to current lineage

Unsplit rationale: lineage scoping, regression tests, and operator docs all change one completion-publication guard in `findOrCreatePr`; no daemon, CLI, or settlement seam.

## Problem

`findOrCreatePr` returns `lane_pr_closed`/`lane_pr_merged` whenever the newest head+base PR is closed or merged, without checking that the PR belongs to the lane being published. A fresh dispatch on a reused branch inherits a prior lineage's closed PR and never opens a draft.

## Decisions

- Extend `listMatchingPrs` all-state `--json` fields to include `headRefOid`. Lineage check runs inside `findOrCreatePr` against the post-push tip and `leaseFromSha` when set.
- Closed/merged history blocks create only when it belongs to the current lineage: the newest PR's `headRefOid` equals or is an ancestor of the pushed tip, or of `leaseFromSha` when set. Reuse the publisher's existing `isAncestor`.
- A newest closed/merged PR whose head is not in the lane's ancestry is foreign: create a fresh draft as if no history existed.
- Missing or empty `headRefOid` on the all-state list row is inconclusive: fail closed (same as unreadable head), never create.
- Ancestry unreadable (head object unavailable after fetch) is inconclusive: return `lane_pr_closed` or `lane_pr_merged` per the PR state, never create.
- Open-draft reuse, probe-failure handling, and resume republish opt-in are unchanged.

## Acceptance criteria

- [ ] `completion-publisher.test.ts`: newest `CLOSED` PR whose head is not an ancestor of the pushed tip → `gh pr create` runs and a new draft is confirmed; fails against current `findOrCreatePr`.
- [ ] Same file: newest `MERGED` PR on a foreign lineage → new draft created; fails against current code.
- [ ] `completion-publisher.test.ts` `returns $kind without create when newest head+base history is $state` stays green for `CLOSED` and `MERGED` after fixtures give an in-lineage `headRefOid` (ancestor of the push tip).
- [ ] Same file: newest `CLOSED` PR whose head is an ancestor of `leaseFromSha` but not of the rebased tip → no create, `lane_pr_closed`.
- [ ] Same file: ancestry check fails (head unreadable) → no create, `lane_pr_closed` or `lane_pr_merged` matching PR state.
- [ ] Same file: newest closed/merged PR with missing or empty `headRefOid` → no create, `lane_pr_closed` or `lane_pr_merged` matching PR state.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — head+base history guard applies only to the current lane lineage.
- `v2/docs/workflow-runner.md` — fresh dispatch on a reused branch opens a new draft despite a prior lineage's closed/merged PR.
- `v2/docs/v1-behaviors.md` — record the lineage-scoped guard.

## Primary implementation surface

v2/src/execution/completion-publisher.ts

## Prerequisites
