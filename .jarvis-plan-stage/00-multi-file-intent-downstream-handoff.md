# 00 - Multi-file intent downstream handoff

## Problem

Multi-file intent landing still records the durable ready-intents **directory** as pipeline handoff. Plan resolution requires a **file**, so a normal split stops the pipeline before plan runs.

## Decisions

- Multi-file landing (N≥2) handoff is `downstreamInputs: string[]` of worktree-relative ready-intent **file** paths, one per markdown file from **this** landing invocation — rules out durable-directory fallback, silently picking one file, and globbing the whole ready-intents tree.
- Single-file landing keeps file-shaped `specPath` on the step-0 entry run and stage artifact; no `downstreamInputs` — rules out always emitting an array or changing the single-file contract from #2359.
- Step-0 entry/write run row and pipeline stage artifact carry the same handoff after intent completion, including review-last / `intent-reviewed` — rules out divergent recording between run row and artifact.
- `pipeline-stage-dispatch` copies persisted entry-run handoff onto the stage artifact unchanged (`specPath` or `downstreamInputs`) — rules out re-deriving inputs in the dispatch seam.
- Multi-file intent publication/commit scope remains the configured durable directory; only pipeline handoff records per-file paths — rules out per-file publication landing or reshaping plan/implement landing in this slice.
- Deferred to fan-out execution: per-branch resolution and dispatch consumers that start plan from each `downstreamInputs` entry — pin when fan-out lands.

## Prerequisites

- Durable pipeline stage records, approval gates, and `pipeline list` / `wait` / `approve` / `reject` / `resume` exist.
- Inter-stage handoff resolves chained inputs from the prior entry-run worktree.
- Intent completion records a concrete ready-intent file on the entry run and stage artifact when landing produces exactly one ready-intent file; the ready-intents directory when landing produces more than one.
- Pipeline stage rows are keyed by `(stageId, branchKey)` and stage artifacts may carry multiple downstream inputs.

## Task checklist

- [ ] `intentHandoffSpecPath` / `landIntentWorkflowOutput` (including idempotent re-land): N≥2 → `downstreamInputs` of worktree-relative file paths; N=1 → file `specPath` unchanged.
- [ ] `persistIntentHandoff` and run persistence: multi-file handoff writes `downstreamInputs` on the step-0 entry/write run row; single-file keeps `specPath`.
- [ ] `pipeline-stage-dispatch`: completed rollup copies entry-run `downstreamInputs` onto the stage artifact when present; single-file keeps today's `specPath` artifact shape.
- [ ] Review-last / `intent-reviewed` completion path persists the same multi-file handoff on the step-0 entry run.
- [ ] Extend `intent-output.test.ts`, `workflow-runner.test.ts`, and `pipeline-stage-dispatch.test.ts` per acceptance criteria.
- [ ] Update `v2/docs/workflow-runner.md` and record multi-file handoff in `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `intent-output.test.ts` — N=2 landing records two concrete worktree-relative ready-intent file paths as downstream inputs; baseline directory handoff and inverting the multi-file guard make the test fail.
- [ ] `workflow-runner.test.ts` — review-last intent completion with N=2 records both file paths on the step-0 entry run; baseline directory recording and inverting the multi-file guard make the test fail.
- [ ] `pipeline-stage-dispatch.test.ts` — after multi-file intent completion, the stage artifact lists both downstream-input file paths; baseline single-path or directory artifact makes the test fail.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- [ ] `v2/docs/workflow-runner.md` — multi-file intent landing handoff records one downstream input per landed ready-intent file.
- [ ] `v2/docs/v1-behaviors.md` — record multi-file intent handoff inputs.
