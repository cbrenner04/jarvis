# Pipeline list/wait lane PR stage observation

## Problem

`pipeline list`, `pipeline wait`, and `projectPipelineSnapshot` still surface publication-failed stage copy or pipeline `failed` rollup after linked stages settle on `lane_pr_merged` or `lane_pr_closed`, so operators see free-form failure detail instead of durable `artifact.lanePrOutcome` and matching stage `status`.

## Decisions

- Pipeline list/wait wire `stages[]` rows for stages settled after `lane_pr_merged` expose `status: "succeeded"` with `artifact.lanePrOutcome.kind` `lane_pr_merged` and `artifact.lanePrOutcome.prNumber`, and `failureDetail` must not carry publication-failed or `completion_publication_missing_pr_evidence` wedge copy — rules out mis-labeling honest merged history as terminal publication failure on the stage row.
- Wire `stages[]` for stages settled after `lane_pr_closed` expose the settled stage `status` from the durable row (not forced `failed` for republication) with `artifact.lanePrOutcome.kind` `lane_pr_closed` and matching `prNumber`, and `failureDetail` must not read as publication-failed — rules out treating operator-closed lane PRs as failed republication in projection-only surfaces.
- Projection-only: reuse durable stage rows written by [pipeline linked-stage lane PR settlement](../v2/spec/20261001T145917Z-lane-pr-outcomes-settle-runs-and-stages/01-pipeline-linked-stage-lane-pr-settlement.md); do not change `settleLinkedStagesFromEntryRunWith` settlement branches here — rules out duplicating settlement logic from the sibling spec.
- When pipeline-level `terminalPublicationFailure` contradicts a stage row already succeeded with `artifact.lanePrOutcome`, list/wait stage projection and `derivePipelineState` prefer the lane-settled stage evidence — rules out `hasPipelineTerminalPublicationFailure` alone forcing publication-failed stage copy or pipeline `failed` rollup. Reachable on main: extend the `daemon-pipeline-observation.test.ts` `projectPipelineSnapshot projects stored terminal and admission diagnostics with JSON omission semantics` fixture pattern (`pipelineWithStages` + stored `terminalPublicationFailure`) with a succeeded stage carrying `artifact.lanePrOutcome`.

## Tasks

- [x] Adjust `projectPipelineSnapshot`, pipeline list/wait handlers, and `derivePipelineState` (projection-only hooks) so lane-settled stages and pipeline rollup match the decisions above.
- [x] Add `daemon-pipeline-observation.test.ts` projection-only fixtures (seeded stage rows with `artifact.lanePrOutcome`, no settlement under test).
- [x] Update `v2/docs/daemon-host.md` and `v2/docs/v1-behaviors.md` for run list/wait `lanePrOutcome`, notification lane incidents, and pipeline stage `artifact.lanePrOutcome` projection.

## Acceptance criteria

- [x] `daemon-pipeline-observation.test.ts` (projection-only, not settlement logic owned by sibling spec): a stage row with `artifact.lanePrOutcome.kind` `lane_pr_merged` projects `status` `succeeded` and merged `artifact.lanePrOutcome.prNumber` on `pipeline_list`/`pipeline_wait` wire `stages[]`, with no publication-failed `failureDetail`; fails against pre-fix free-form failure detail.
- [x] Same test surface: a stage row with `artifact.lanePrOutcome.kind` `lane_pr_closed` projects `lane_pr_closed` on `stages[].artifact.lanePrOutcome` and PR number without publication-failed `failureDetail`; fails against pre-fix publication-failed stage observation.
- [x] `daemon-pipeline-observation.test.ts`: with stale pipeline `terminalPublicationFailure` and a succeeded stage carrying `artifact.lanePrOutcome`, `projectPipelineSnapshot` / `derivePipelineState` do not report pipeline `state` `failed` or publication-failed stage observation solely from `terminalPublicationFailure`; fails against pre-fix `hasPipelineTerminalPublicationFailure` rollup on the contradiction fixture above.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass. (Manual)

## Documentation updates

- `v2/docs/daemon-host.md` — run list/wait `lanePrOutcome`, notification incidents, and pipeline list/wait stage `artifact.lanePrOutcome` include `lane_pr_closed` / `lane_pr_merged` with PR numbers when configured.
- `v2/docs/v1-behaviors.md` — daemon projection and notifications for lane PR closed/merged settlement (behavior change vs pre-fix publication-failure-only reporting).
