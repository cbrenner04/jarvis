# Lineage-scoped head+base history guard in completion publication

## Problem

`findOrCreatePr` (`v2/src/execution/completion-publisher.ts`) treats the newest closed or merged head+base PR as blocking create for every later publish on that branch name, even when that PR's head commit belongs to an earlier lane lineage. Fresh dispatch on a reused branch then returns `lane_pr_closed`/`lane_pr_merged` and never opens a draft.

## Decisions

- Extend all-state `listMatchingPrs` `--json` to include `headRefOid` alongside `number`, `baseRefName`, and `state` — rules out inferring lineage from PR number or list order alone.
- Thread the post-push tip SHA (same value recorded as `pushSha`) and optional `leaseFromSha` from `createCompletionPublisher` into `findOrCreatePr` for the closed/merged guard only — rules out checking ancestry against a stale pre-push HEAD or against remote tip without the push having completed.
- At the newest closed/merged row, classify lineage tri-state against post-push tip and, when set, `leaseFromSha` (equals or confirmed ancestor on each anchor): **in-lineage** → `lane_pr_closed` or `lane_pr_merged`; **foreign** → skip guard and create; **inconclusive** (missing/empty `headRefOid`, or head not evaluable in git after list) → same lane outcomes as in-lineage — rules out branch-name lockout on foreign dead PRs, fail-open create on ODB/`merge-base` failure, and create on missing list oid.
- Closed/merged guard uses a discriminating git helper or seam; lease push and other call sites keep module-local `isAncestor` — rules out treating `isAncestor`'s `false` (including `merge-base` catch) as foreign at the history guard while avoiding a second graph-walk with divergent success semantics.
- `allowLanePrRepublish`, open-draft reuse via `resolveOpenDraftPr`, and all-state list probe throw handling stay unchanged — rules out bundling settlement, CLI, or republish semantics in this slice.

## Task checklist

- [ ] Extend `PrListRecord` / all-state `listMatchingPrs` json fields with `headRefOid`.
- [ ] Pass post-push tip and optional `leaseFromSha` into `findOrCreatePr`; implement tri-state closed/merged lineage evaluation before returning lane outcomes on the no-open-match path.
- [ ] Add discriminating lineage helper or git seam at the guard (in-lineage / foreign / inconclusive); do not use bare `isAncestor` false as foreign.
- [ ] Extend `ghOpenEmptyThenAllHistory` (or adjacent helpers) so preservation and new cases can supply `headRefOid` and git seams for ancestry evaluation.
- [ ] Add regression cases and adjust existing lane-history tests per acceptance criteria.
- [ ] Update `v2/docs/write-behavior.md`, `v2/docs/workflow-runner.md`, and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [x] `completion-publisher.test.ts`: newest `CLOSED` PR whose `headRefOid` is not an ancestor of the post-push tip → `gh pr create` runs and a new draft is confirmed; fails against pre-fix `findOrCreatePr` (reachable on main: foreign closed history blocks create today).
- [x] Same file: newest `MERGED` PR on a foreign lineage → new draft created; fails against pre-fix `findOrCreatePr`.
- [x] `completion-publisher.test.ts` — `returns $kind without create when newest head+base history is $state` stays green for `CLOSED` and `MERGED` after fixtures supply an in-lineage `headRefOid` (ancestor of the post-push tip).
- [x] Same file: newest `CLOSED` PR whose head is an ancestor of `leaseFromSha` but not of the rebased post-push tip → no create, `lane_pr_closed`.
- [x] Same file: ancestry check inconclusive (head unreadable in git) → no create, `lane_pr_closed` or `lane_pr_merged` matching PR state.
- [x] Same file: newest closed/merged PR with missing or empty `headRefOid` → no create, `lane_pr_closed` or `lane_pr_merged` matching PR state.
- [x] `completion-publisher.test.ts` — `requests isDraft on the open probe and state on the all-state history probe` updated so the all-state `--json` field list includes `headRefOid`.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — head+base closed/merged guard applies only when the newest PR head commit is in the current lane lineage (post-push tip and optional `leaseFromSha` ancestry); foreign history does not block create.
- `v2/docs/workflow-runner.md` — fresh dispatch on a reused branch opens a new draft only when the newest closed/merged PR's `headRefOid` is outside post-push tip / `leaseFromSha` ancestry; a reused branch whose tip still contains that dead PR head in history remains blocked; in-lineage dead PR behavior unchanged.
- `v2/docs/v1-behaviors.md` — record lineage-scoped head+base history guard relative to the prior branch-wide block.
