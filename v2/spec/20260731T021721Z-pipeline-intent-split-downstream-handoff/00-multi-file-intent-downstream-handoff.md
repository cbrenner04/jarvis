# 00 - Multi-file intent downstream handoff

## Problem

Multi-file intent landing still records the durable ready-intents **directory** as pipeline handoff. Plan resolution requires a **file**, so a normal split stops the pipeline before plan runs.

## Decisions

- **Publication vs pipeline handoff:** publication/commit/finalization continue to use the configured durable directory (`intentPublicationSpecPath` / `landing.output.durableDir`); pipeline handoff is a separate surface — rules out one overloaded `specPath` return consumed by both publication and persistence.
- **Run-row storage (additive):** N≥2 retains directory-shaped `specPath` on the step-0 entry/write run for publication/resume and adds `downstreamInputs: string[]` for pipeline; N=1 keeps file-shaped `specPath`, no `downstreamInputs` — rules out clearing `spec_path` or migrating every `writeRun.specPath` consumer in this slice.
- Multi-file pipeline handoff (N≥2) is `downstreamInputs` of worktree-relative ready-intent **file** paths, one per markdown file from **this** landing invocation, order pinned to landing/validation order — rules out durable-directory fallback, silently picking one file, globbing the whole ready-intents tree, and unordered arrays.
- Step-0 entry/write run row and pipeline stage artifact carry the same handoff after intent completion (write-last and review-last / `intent-reviewed`) — rules out divergent recording between run row and artifact.
- `pipeline-stage-dispatch` copies persisted entry-run handoff onto the stage artifact unchanged (`specPath` plus `downstreamInputs` when present) — rules out re-deriving inputs in the dispatch seam.
- Widen `PipelineStageArtifact`, relax dispatch completion guards that require only `entryRun.specPath`, and update `carryForwardArtifact` (and terminal validation) so `downstreamInputs`-bearing artifacts are not dropped on resume/replay.
- **Scope:** this slice records correct per-file handoff only; multi-file pipelines **still fail at plan resolution after merge** until fan-out consumes `downstreamInputs` (`pipeline-intent-split-fans-out-downstream-stages`) — rules out implying end-to-end pipeline continuation.
- Deferred to fan-out execution: per-branch resolution and dispatch consumers that start plan from each `downstreamInputs` entry.
- Plan and implement landing shapes unchanged — rules out reshaping downstream publication in this slice.

## Prerequisites

- Durable pipeline stage records, approval gates, and `pipeline list` / `wait` / `approve` / `reject` / `resume` exist.
- Inter-stage handoff resolves chained inputs from the prior entry-run worktree.
- Single-file intent handoff records a concrete ready-intent file on the entry run and stage artifact (#2359).
- Pipeline stage rows are keyed by `(stageId, branchKey)`; stage artifacts may carry `downstreamInputs`.
- Fan-out downstream-stages work (`pipeline-intent-split-fans-out-downstream-stages`) is the forward consumer for recorded multi-file `downstreamInputs`; not merged in this slice.

## Task checklist

- [ ] Handoff API: introduce `intentPipelineHandoff` (or equivalent union return) separating publication `specPath` (`intentPublicationSpecPath`) from pipeline fields (`specPath` file or `downstreamInputs`); update `landIntentWorkflowOutput` idempotent re-land, `persistIntentHandoff`, review-last / write-last landing paths, and tests — rules out assigning `downstreamInputs` to `intentHandoffSpecPath` (`string` today).
- [ ] `landIntentWorkflowOutput` (including idempotent re-land): N≥2 → `downstreamInputs` of worktree-relative file paths; N=1 → file `specPath`, no `downstreamInputs`; publication scope stays durable directory.
- [ ] Run persistence: `setRunDownstreamInputs` (or equivalent) plus `persistIntentHandoff` — multi-file writes directory `specPath` and `downstreamInputs` on the step-0 entry/write run; single-file keeps file `specPath` only.
- [ ] Review-last and write-last completion paths persist the same multi-file handoff on the step-0 entry run.
- [ ] `PipelineStageArtifact`: optional `downstreamInputs`; dispatch completion rollup copies entry-run `specPath` and `downstreamInputs` unchanged; relax `entryRun.specPath`-only guards; update `carryForwardArtifact` and terminal validation.
- [ ] Extend `intent-output.test.ts`, `workflow-runner.test.ts`, and `pipeline-stage-dispatch.test.ts` per acceptance criteria.
- [ ] Update `v2/docs/workflow-runner.md`, `v2/docs/daemon-host.md` (recorded vs consumed), and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `intent-output.test.ts` — N=2 landing records two worktree-relative ready-intent file paths in `downstreamInputs` (directory `specPath` retained for publication); baseline directory-only pipeline handoff and `invertMultiFileHandoffGuardForTest` make the test fail.
- [ ] `intent-output.test.ts` — with unrelated files already in `ready-intents/`, N=2 from this invocation yields exactly those two paths in `downstreamInputs`, not a durable-dir glob; guard inversion makes the test fail.
- [ ] `intent-output.test.ts` — N≥2 idempotent re-land early-return preserves the same `downstreamInputs` and directory `specPath`; `invertMultiFileHandoffGuardForTest` makes the test fail.
- [ ] `intent-output.test.ts` — `downstreamInputs` order matches landing/validation order; order mutation makes the test fail.
- [ ] `workflow-runner.test.ts` — write-last (no review) intent completion with N=2 records both file paths in `downstreamInputs` on the step-0 entry run; baseline directory recording and `invertMultiFileHandoffGuardForTest` make the test fail.
- [ ] `workflow-runner.test.ts` — review-last intent completion with N=2 records both file paths in `downstreamInputs` on the step-0 entry run; baseline directory recording and `invertMultiFileHandoffGuardForTest` make the test fail.
- [ ] `pipeline-stage-dispatch.test.ts` — after multi-file intent completion, the stage artifact lists both `downstreamInputs` file paths (and directory `specPath` when additive); baseline single-path or directory-only artifact makes the test fail.
- [ ] `intent-output.test.ts` — "lands one valid intent and records file handoff specPath", "idempotent re-land early-return applies the same handoff rules", and "inverting the single-file guard fails single-file handoff" stay green (#2359 N=1 preservation).
- [ ] `workflow-runner.test.ts` — "review-last light intent completion records file handoff on the step-0 entry run", "resumes intent finalization from a populated stage without review re-invocation", and "single-file intent handoff specPath passes plan-stage ready-intent validation" stay green (#2359 preservation).
- [ ] `publication-landing.test.ts` stays green (publication scope unchanged).
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- [ ] `v2/docs/workflow-runner.md` — multi-file intent landing records one `downstreamInputs` entry per landed ready-intent file; publication stays on the durable directory.
- [ ] `v2/docs/daemon-host.md` — multi-file `downstreamInputs` are recorded on completion but not consumed for plan resolution until fan-out (`pipeline-intent-split-fans-out-downstream-stages`).
- [ ] `v2/docs/v1-behaviors.md` — record multi-file intent handoff inputs (recorded vs consumed).
