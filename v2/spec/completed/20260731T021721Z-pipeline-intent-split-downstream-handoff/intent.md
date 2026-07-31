---
name: pipeline-intent-split-downstream-handoff
---

# Splitting intent landing records one downstream input per ready-intent file

## Problem

Multi-file intent landing still hands off the ready-intents directory. Plan resolution requires a
file, so a normal split stops the pipeline before plan runs.

## Decisions

- Publication/commit/finalization stay on the configured durable directory; pipeline handoff is a separate surface — rules out one overloaded landing return consumed by publication and persistence.
- When this landing produces N≥2 ready-intent markdown files, pipeline handoff records N `downstreamInputs`, each the landed file's worktree-relative path; run row keeps directory-shaped `specPath` for publication/resume (additive storage) — rules out the durable-directory fallback as the only pipeline handoff, silently picking one file, and operator re-entry per intent.
- N=1 keeps file-shaped `specPath` on the entry run and stage artifact; no `downstreamInputs` (#2359) — rules out always emitting an array.
- "This landing" means markdown files produced by the current landing invocation, not every file already under the durable directory — rules out globbing the whole ready-intents tree.
- The step-0 entry/write run row and pipeline stage artifact carry the same handoff after intent completion (write-last and review-last / `intent-reviewed`) — rules out divergent handoff between run row and stage artifact.
- `pipeline-stage-dispatch` copies persisted entry-run handoff unchanged onto the stage artifact — rules out re-deriving inputs in the daemon dispatch seam.
- This slice records correct per-file handoff only; multi-file pipelines still fail at plan resolution until fan-out consumes `downstreamInputs` (`pipeline-intent-split-fans-out-downstream-stages`).
- Plan and implement landing shapes are unchanged — rules out reshaping downstream publication in this slice.

## Acceptance criteria

- [ ] `intent-output.test.ts` — N=2 landing records two concrete worktree-relative ready-intent file paths as downstream inputs; baseline directory handoff and inverting the multi-file guard make the test fail.
- [ ] `workflow-runner.test.ts` — review-last intent completion with N=2 records both file paths on the step-0 entry run; baseline directory recording and inverting the multi-file guard make the test fail.
- [ ] `pipeline-stage-dispatch.test.ts` — after multi-file intent completion, the stage artifact lists both downstream-input file paths; baseline single-path or directory artifact makes the test fail.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — multi-file intent landing handoff records one downstream input per landed ready-intent file.
- `v2/docs/daemon-host.md` — recorded vs consumed multi-file handoff until fan-out.
- `v2/docs/v1-behaviors.md` — record multi-file intent handoff inputs.

## Prerequisites

- Durable pipeline stage records, approval gates, and `pipeline list` / `wait` / `approve` / `reject` / `resume` exist.
- Inter-stage handoff resolves chained inputs from the prior entry-run worktree.
- Single-file intent handoff records a concrete ready-intent file on the entry run and stage artifact (#2359).
- Pipeline stage rows are keyed by `(stageId, branchKey)` and stage artifacts may carry multiple downstream inputs.
- Fan-out downstream-stages work (`pipeline-intent-split-fans-out-downstream-stages`) consumes recorded `downstreamInputs`; not merged in this slice.
