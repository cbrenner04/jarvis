# Wire review-feedback preset admission through CLI and daemon workflow start

## Problem

Operators have no `jarvis run workflow review-feedback` path that runs lane resolution, the PR/capture prelude, and admits a write-step workflow on the resolved lane.

## Prerequisites

- Subspecs `00-review-feedback-lane-resolution.md` and `01-review-feedback-pr-review-and-capture-prelude.md`.

## Decisions

- Register `review-feedback` in `WORKFLOW_PRESET_BUILDERS` with a minimal builder that accepts admission-time lane context (resolved target + `laneKind`) and returns exactly one `write` step stub identified for later replacement — rules out blocking this spec on the full prompt/write contract owned by `review-feedback-write-run`.
- Extend `resolveWorkflowPresetBuilder` / workflow CLI parsing to accept `review-feedback` and flags `--branch` (required), `--pipeline`, `--stage`, and `--branch-key` (pipeline disambiguators per subspec `00`) — rules out a separate top-level subcommand.
- Lane resolution and prelude run in CLI `runWorkflowCommand` with injectable `StateStore` and `AsyncSubprocessRunner` before `prepareWorkflowStart`; daemon `admitWorkflowStart` consumes prepared steps only (no second resolution/prelude) — rules out split implementations that pass CLI-only or daemon-only tests.
- Run resolution → prelude → builder → `prepareWorkflowStart` → daemon `admitWorkflowStart`; any refusal short-circuits before worktree claim or spawn with RPC/CLI detail carrying the stable refusal code — rules out partial admission that leaves a phantom run row.
- Reuse the shared workflow-start preparation path (`prepareWorkflowStart`; pipeline adapter parity not required — standalone only).
- `review-feedback` is not a member of `STALE_RESET_WORKFLOWS`; stale-reset preflight does not run for this preset. Dirty worktree, claim, and generic ownership failures stay ordinary harness errors outside the review-feedback refusal table — rules out inferring reset behavior from "follows an existing lane" alone.
- Admitted workflow start must bind the resolved lane's `worktreePath` and `branch` from `ReviewFeedbackLaneTarget` on the prepared write step (not CLI cwd defaults) — rules out admitting review-feedback while leaving the run on the operator's checkout branch.
- `CliWorkflowPresetName` expands to include `review-feedback` when the builder registers — aligns with `PIPELINE_ELIGIBILITY` already listing the name.
- Integration tests use fake IPC/daemon fixtures mirroring existing `workflow.test.ts` / `daemon-workflow-admission-handlers.test.ts` patterns with mocked `gh` and store seeding — rules out live GitHub in automated ACs.

## Tasks

- Add CLI arg parser for review-feedback disambiguators; thread refusal codes to stderr/exit like other workflow admission failures.
- Register `review-feedback` disambiguator flags on the `run workflow` command tree and ensure `jarvis help run workflow review-feedback` lists every parser-accepted flag (same discovery contract as other presets).
- Implement minimal `buildReviewFeedbackWorkflowSteps` (or equivalent) and register in `WORKFLOW_PRESET_BUILDERS`.
- Hook resolution + prelude into workflow start preparation before step build completes.
- Add regression tests covering successful admission for completed bare intent, plan, and implement lanes and a pipeline stage (flags per `00`), plus named refusals for in-flight lane, no review, merged/closed PR, non-eligible workflow kind, unmatched/ambiguous targeting, and capture-prelude failure.
- Document operator entrypoint and refusal codes in `v2/docs/operator-runbook.md`.

## Acceptance criteria

- [ ] `review-feedback-workflow-admission.test.ts` test `admits a completed bare intent lane with an open reviewed PR` fails against the pre-fix code and passes after implementation.
- [ ] The same file's tests `admits a completed bare plan lane`, `admits a completed bare implement lane`, and `admits a completed pipeline stage with disambiguators` pass.
- [ ] `review-feedback-workflow-admission.test.ts` test `admits using the resolved lane worktree path and branch` fails against the pre-fix code and passes after implementation.
- [ ] Tests `refuses in-flight lane`, `refuses open PR with no review`, `refuses merged PR`, `refuses closed PR`, `refuses non intent-plan-implement target`, `refuses unmatched lane`, `refuses ambiguous bare lane`, and `refuses capture prelude failure` each assert the stable refusal code from subspecs `00`–`01` and fail against the pre-fix code.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.
- [ ] `v2/src/cli.test.ts` workflow help regression for `review-feedback` lists every parser-accepted disambiguator flag; it fails against the pre-fix tree and passes after registration.

## Documentation updates

- `v2/docs/operator-runbook.md` — `jarvis run workflow review-feedback` targeting (bare `--branch` vs `--pipeline` / `--stage` / `--branch-key`), prerequisite that the lane finished publication with reviews on the open PR, refusal code table aligned with subspecs `00`–`01` (including `review_feedback_pr_branch_mismatch`), note that rollup-completed lanes without a full `prNumber`+`prUrl` pair do not match (`review_feedback_lane_unmatched`), and that `review_feedback_lane_in_flight` covers any non-terminal run on `(project, branch)` (including `paused`) without per-cause codes.
