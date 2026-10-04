# Run list/wait lane PR operator error

## Problem

`run list` and `run wait` compose operator errors through `composeRunOperatorError` and durable run rows. After lane PR settlement, terminal runs carry `lane_pr_closed` or `lane_pr_merged` on `loop_finished` and/or settlement evidence, but list/wait rows omit the lane outcome and blocking PR number or substitute publication-failure diagnosis.

## Decisions

- List/wait RPC run rows (`buildRunListRow` in `daemon-run-lifecycle-handlers.ts`) expose top-level `lanePrOutcome: { kind: "lane_pr_closed" | "lane_pr_merged"; prNumber: number }` whenever durable settlement named a lane outcome, including terminal `completed` rows where `error` is omitted — rules out a pass that only adds fields inside `composeRunOperatorError` without changing list/wait JSON operators read.
- When `error` is present (`runListRowError` → `composeRunOperatorError`), the same `lanePrOutcome` appears on `error`, and `error.reason` is not `completion_commit_failed` or other publication-failure reasons if lane settlement already won — rules out publication-failure diagnosis on the operator error surface.
- Durable source order when signals disagree: terminal `loop_finished.lanePrOutcome` over run-row lane settlement fields over top-level `prNumber`/`prUrl` from `runListPrEvidence` alone — rules out inferring outcome kind from PR number without `lanePrOutcome`.
- `composeRunOperatorError` and the row builder project `lane_pr_closed` and `lane_pr_merged` with the PR number from that ordered read without inventing a different reason — rules out silent `completed` rows and rules out generic harness failure when the durable record already settled a lane outcome.
- Existing operator-error fields (`publicationFailure`, `completionCommitError`, `operatorFailureRecord`, PR evidence when present) stay on the same row when applicable — rules out dropping structured publication detail on unrelated failures.

## Tasks

- [ ] Extend `composeRunOperatorError` and `buildRunListRow` / `runListRowError` to surface `lanePrOutcome` on list/wait rows per the decisions above.
- [ ] Add daemon list/wait regression coverage with durable fixtures seeded to lane-outcome terminal settlement (not publication create paths).
- [ ] No `daemon-host.md` / `v1-behaviors.md` edits here; subspec 02 owns doc closure for this spec.

## Acceptance criteria

- [x] `daemon-start-list.test.ts` or `daemon-wait-run-completion.test.ts`: a run settled `lane_pr_closed` projects `lanePrOutcome.kind` `lane_pr_closed` and `lanePrOutcome.prNumber` on the list/wait row; fails against pre-fix rows that omit `lanePrOutcome` or substitute publication-failure `error.reason`.
- [x] Same test surface: a run settled `lane_pr_merged` projects `lanePrOutcome.kind` `lane_pr_merged` and `lanePrOutcome.prNumber` (not PR number via `runListPrEvidence` alone); fails against pre-fix merged rows that omit outcome kind.

## Documentation updates

- None in this subspec (run list/wait lane fields are documented in [02 — Pipeline list/wait lane PR stage observation](./02-pipeline-list-wait-lane-pr-stage-observation.md) together with notifications).
