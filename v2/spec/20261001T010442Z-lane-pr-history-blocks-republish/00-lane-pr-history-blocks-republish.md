# Head+base PR history blocks create unless republish opt-in

## Problem

`findOrCreatePr` (`v2/src/execution/completion-publisher.ts`) calls `resolveOpenDraftPr` (open PRs only), then `gh pr create` when no open draft matches. That create path can open a duplicate draft when the newest head+base PR history is closed or merged. This subspec only guards create inside the publisher; write-loop settlement when publication returns a lane outcome without `prNumber` is [01-lane-pr-outcome-write-loop-settlement](./01-lane-pr-outcome-write-loop-settlement.md).

## Decisions

- After `resolveOpenDraftPr` returns no match and before `gh pr create`, list head+base PRs with `gh pr list --state all` filtered to the requested `baseRef` — rules out create-on-empty-open-list without consulting closed or merged history.
- When the filtered list is nonempty, take the newest entry by GitHub list order (same default as `gh pr list`: created descending) — rules out arbitrary pick among multiple historical PRs.
- When that newest entry is `CLOSED` (unmerged) or `MERGED`, refuse create and surface a named lane outcome carrying its PR number: `lane_pr_closed` or `lane_pr_merged` — rules out silently opening a fresh draft and rules out reusing the dead PR number as publication evidence.
- When an open draft matches via `resolveOpenDraftPr`, reuse it unchanged; older closed or merged rows in the all-state list do not block — rules out treating stale history as authoritative over a live draft.
- When `allowLanePrRepublish` on `CompletionPublisherInput` is true, skip the closed/merged newest-history guard and run the existing create path — rules out implicit operator opt-in and rules out a separate code path outside `findOrCreatePr`.
- When the all-state list probe throws, do not create; surface a permanent publication failure naming the probe error on the `"pr"` operation — rules out falling through to create on inconclusive history.
- `allowLanePrRepublish` is optional on `CompletionPublisherInput` and threads through `createCompletionPublisher` / `runPublisher` unchanged; this slice does not add CLI flags or set the flag from workflow callers — rules out bundling operator-facing admission in the same change.
- `lane_pr_closed` / `lane_pr_merged` surface on `CompletionPublisherResult` via a dedicated field (e.g. `lanePrOutcome: { kind; prNumber }`), not by throwing from `findOrCreatePr` and not by populating `prNumber` / `prUrl` — rules out ad hoc errors and rules out successful `PrEvidence` shape for dead PRs.
- When `lanePrOutcome` is set, `createCompletionPublisher` completes the `"pr"` publication step and returns without running `pr-body-refresh` — rules out refresh/order coupling that assumes a live draft PR.

## Task checklist

- [ ] Add `listMatchingPrsAllStates` (or equivalent) and invoke it from `findOrCreatePr` only on the no-open-match create path.
- [ ] Extend `CompletionPublisherResult` and `findOrCreatePr` so `lane_pr_closed` / `lane_pr_merged` are returned through `createCompletionPublisher` per the publication-boundary decisions.
- [ ] Add `allowLanePrRepublish?: boolean` to `CompletionPublisherInput` and pass it into `findOrCreatePr`.
- [ ] Extend `runPublisher` / `publishCompletionArtifacts` input spread so an upstream caller may set `allowLanePrRepublish` without loss (no settlement behavior in this slice).
- [ ] Rewrite or retire `completion-publisher.test.ts` — `creates a fresh draft PR when the branch's only PR history is merged/closed` — as part of the all-state guard flip.
- [ ] Add regression cases in `completion-publisher.test.ts` per acceptance criteria.
- [ ] Update `v2/docs/write-behavior.md`, `v2/docs/workflow-runner.md`, and `v2/docs/v1-behaviors.md` (include the intentional operator gap until subspec 01 lands).

## Acceptance criteria

- [ ] `completion-publisher.test.ts`: fake `gh` with newest same-base PR `CLOSED` → no `gh pr create`, `lanePrOutcome` `lane_pr_closed` with that number, no `prNumber`/`prUrl`, body-refresh seams not invoked; fails against pre-fix `findOrCreatePr`.
- [ ] Same file: newest `MERGED` → no create, `lanePrOutcome` `lane_pr_merged` with that number, no `prNumber`/`prUrl`; fails against pre-fix create path.
- [ ] Same file: `allowLanePrRepublish` on publisher input with only closed history → `gh pr create` runs and confirms a new draft.
- [ ] Same file: list probe throws → no create, permanent publication failure carries the probe cause; fails against pre-fix create-on-empty-open-list.
- [ ] `completion-publisher.test.ts` — `reuses existing open PR with matching base` and `reuses an open draft PR without changing its title` stay green.
- [ ] `completion-publisher.test.ts` — `creates a fresh draft PR when the branch's only PR history is merged/closed` is rewritten or retired in favor of the CLOSED/MERGED guard cases above.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — head+base PR resolution consults closed and merged history before create; document `allowLanePrRepublish` on completion publication input; note that until lane-outcome settlement (subspec 01) lands, a pushed completion can still fail upstream when the publisher returns `lanePrOutcome` without `prNumber`.
- `v2/docs/workflow-runner.md` — `findOrCreatePr` no longer opens a fresh draft when newest head+base history is closed or merged unless republish opt-in is set; same operator gap until subspec 01.
- `v2/docs/v1-behaviors.md` — record the changed completion-publication PR guard relative to v1 open-only checks and the prior v2 open-only-only doc line.
