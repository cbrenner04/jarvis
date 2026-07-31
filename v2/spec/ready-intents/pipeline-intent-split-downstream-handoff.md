---
name: pipeline-intent-split-downstream-handoff
---

# Splitting intent landing records one downstream input per ready-intent file

## Problem

Multi-file intent landing still hands off the ready-intents directory. Plan resolution requires a
file, so a normal split stops the pipeline before plan runs.

## Decisions

- When this landing produces N ready-intent markdown files, handoff records N downstream inputs, each the landed file's worktree-relative path — rules out the durable-directory fallback, silently picking one file, and operator re-entry per intent.
- "This landing" means markdown files produced by the current landing invocation, not every file already under the durable directory — rules out globbing the whole ready-intents tree.
- The step-0 entry/write run row and pipeline stage artifact carry the same N inputs after intent completion (including review-last / `intent-reviewed`) — rules out divergent handoff between run row and stage artifact.
- `pipeline-stage-dispatch` reads the persisted handoff unchanged — rules out re-deriving inputs in the daemon dispatch seam.
- Plan and implement landing shapes are unchanged — rules out reshaping downstream publication in this slice.

## Acceptance criteria

- [ ] `intent-output.test.ts` — N=2 landing records two concrete worktree-relative ready-intent file paths as downstream inputs; baseline directory handoff and inverting the multi-file guard make the test fail.
- [ ] `workflow-runner.test.ts` — review-last intent completion with N=2 records both file paths on the step-0 entry run; baseline directory recording and inverting the multi-file guard make the test fail.
- [ ] `pipeline-stage-dispatch.test.ts` — after multi-file intent completion, the stage artifact lists both downstream-input file paths; baseline single-path or directory artifact makes the test fail.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — multi-file intent landing handoff records one downstream input per landed ready-intent file.
- `v2/docs/v1-behaviors.md` — record multi-file intent handoff inputs.

## Prerequisites

- Durable pipeline stage records, approval gates, and `pipeline list` / `wait` / `approve` / `reject` / `resume` exist.
- Inter-stage handoff resolves chained inputs from the prior entry-run worktree.
- Intent completion records a concrete ready-intent file on the entry run and stage artifact when landing produces exactly one ready-intent file; the ready-intents directory when landing produces more than one.
- Pipeline stage rows are keyed by `(stageId, branchKey)` and stage artifacts may carry multiple downstream inputs.
