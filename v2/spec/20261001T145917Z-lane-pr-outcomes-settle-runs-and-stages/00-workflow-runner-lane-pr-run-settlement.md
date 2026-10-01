# Workflow-runner lane PR run settlement

## Problem

Completion publication can return `lanePrOutcome` or a permanent head+base list-probe failure without `gh pr create`, and the write loop can finish with `lanePrOutcome` on `loop_finished`, but workflow-runner completion republication (fresh completion, resume, and pipeline-driven recovery) still settles or retries as if publication never succeeded — `completion_commit_failed`, `failed` with resumable republication, or a second create path — instead of honoring closed/merged lane history and probe failures on the durable run row.

## Decisions

- `lane_pr_merged` through workflow-runner completion publication settles the publication run `status: "completed"` with merged PR `prNumber`/`prUrl` on the durable settlement write and `terminalCause: "complete"` — rules out terminal success that keeps evidence only on `loop_finished.lanePrOutcome` while the run row lacks PR fields pipeline settlement reads.
- `lane_pr_closed` settles the publication run terminal without `status: "failed"` and records `lane_pr_closed` with the blocking PR number on settlement evidence and terminal `loop_finished` — rules out classifying operator-closed lane PRs as `completion_commit_failed` or other resumable publication failures that re-enter create on resume without republish opt-in.
- Permanent publication failure from a failed head+base list probe settles the run `failed` with the probe error message on the durable row and non-resumable republication where the publisher marks the `"pr"` step permanent — rules out retryable `completion_commit_failed` tails that resume back into duplicate publication.
- Resume and recovery republication paths that replay completion publication with closed-or-merged newest history and no republish opt-in do not call `gh pr create` and do not append a second republication failure after an honest lane outcome — rules out duplicate-draft republication reachable on pre-fix resume after publication stopped before create.

## Tasks

- [x] Map `lanePrOutcome` from successful completion publication through workflow-runner `publishWithReadyRepair` / terminal settlement into `commitTerminalRunSettlement` (or `commitCompletionBoundary`) with the shapes above.
- [x] Map permanent list-probe publication failures through the same workflow-runner publication tail into durable `failed` rows with probe text.
- [x] Add `workflow-runner-publication.test.ts` end-to-end fixtures (fake `gh`, stopped-before-create or merged/closed history) per acceptance criteria.
- [x] Update operator-facing docs for run-level settlement per Documentation updates.

## Acceptance criteria

- [x] `workflow-runner-publication.test.ts`: completion publication through workflow-runner with fake `gh` where newest head+base history is `MERGED` settles the run `completed` with merged PR evidence on the durable row, does not append a republication failure, and does not call `gh pr create` on resume without republish opt-in; fails against pre-fix behavior that leaves PR evidence missing or re-attempts create.
- [x] Same file: newest history `CLOSED` settles terminal `lane_pr_closed` without `status: "failed"` and without a resumable republication recovery path that opens another draft; fails against pre-fix duplicate-draft republication.
- [x] Same file: all-state history probe throw settles `failed` with the probe message on the run row; fails against pre-fix retryable publication failure or missing probe text on the durable row.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — completion republication (resume/recovery) settles `lane_pr_merged` and `lane_pr_closed` on the durable run row and does not re-enter create without republish opt-in; list-probe permanent failures on the run row.
- `v2/docs/v1-behaviors.md` — run-level lane PR closed/merged terminal settlement and list-probe publication failure (behavior change vs pre-fix republication-failed or duplicate-draft paths).
