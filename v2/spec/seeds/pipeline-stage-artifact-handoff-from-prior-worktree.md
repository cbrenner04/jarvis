---
name: pipeline-stage-artifact-handoff-from-prior-worktree
---

# Pipeline stages hand off concrete artifacts from the prior stage worktree

## Problem

Pipeline stage resolution chains each workflow stage to the previous one's `Run.specPath`
via `pipeline-stage-dispatch` artifacts, then `pipeline-stage-resolve` reads that path from
`join(PipelineContext.cwd, priorSpecPath)` when building the next preset.

That breaks real walks in two ways:

1. **Wrong shape.** Intent's durable write row records `specPath` as the ready-intents
   **directory** (e.g. `v2/spec/ready-intents`). Plan's builder requires a **file**
   (`validateReadyIntent` calls `statSync(path).isFile()`). The chained path fails before
   any agent runs.

2. **Wrong root.** Intent and plan land outputs on their **external worktrees**
   (`intent/<slug>`, `plan/<name>`) and publish draft PRs against `main`. Resolution
   re-reads the chained path from the operator's **primary checkout** (`context.cwd` at
   `pipeline start`), where those files do not exist until someone merges the prior PR.
   `fast` (no approval gates) fails immediately after intent; `full-review` only pauses
   long enough to merge manually — and still passes a directory path to plan.

The shipped e2e proof (#2352) pre-seeds ready-intent/plan files in the repo root and stubs
dispatch so `specPath` is already a concrete file path. That does not match production
intent/plan runs.

## Decisions

- Handoff is **artifact-driven**, not merge-driven: a succeeding workflow stage must record
  enough information for the next stage to resolve without requiring the prior PR on `main`.
  Rules out documenting "merge at each approval gate" as the only supported operator path.
- The pipeline stage artifact's `specPath` names the **next-stage input** — a concrete
  ready-intent file for plan, a concrete plan spec tree (directory with `index.md`) for
  implement — not the write row's internal durable-dir placeholder when they differ.
  Rules out passing `Run.specPath` through unchanged when it is only a landing root.
- Next-stage builders resolve chained paths against the **prior stage entry run's
  worktree** (`store.loadRun(artifact.entryRunId).worktreePath`), not `PipelineContext.cwd`.
  Rules out copying published files back into the operator checkout as part of handoff.
- **Single ready-intent** is in scope for `fast` and the first plan stage after intent.
  Multi-intent splits that emit more than one ready-intent file defer explicit routing
  (separate plan stages or operator choice) — pin when a pipeline definition needs it;
  this seed must not block the one-file path.
- `PipelineContext.cwd` stays the project/admission anchor for project registry lookup and
  intent seed input; only **inter-stage** reads move to the prior worktree.
- `full-review` approval gates stay human checkpoints only; they do not perform git merges
  or mutate handoff paths.

## Acceptance criteria

- [ ] After a git-enabled intent stage succeeds in a pipeline, the recorded stage artifact
      `specPath` is a worktree-relative **ready-intent file** path (not the ready-intents
      directory alone), and resolving the plan stage succeeds without files present in the
      operator's primary checkout.
- [ ] After a git-enabled plan stage succeeds, resolving the implement stage succeeds using
      the plan entry run worktree and the plan spec tree path — again without requiring the
      plan PR on `main`.
- [ ] `fast` (`intent(none) → plan(none) → implement(light)`) can walk intent → plan →
      implement resolution in an integration test that uses real `resolveStageWorkflowSteps`
      and real worktree paths; faking is limited to agent dispatch/wait (same boundary as
      #2352). Inverting the worktree-root guard makes that test fail.
- [ ] `pipeline-stage-resolve.test.ts` drops cwd-primary-checkout assumptions for
      inter-stage handoff; a test proves plan reads `join(priorWorktree, artifact.specPath)`
      (or equivalent) rather than `join(context.cwd, artifact.specPath)`.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` § Pipeline stage resolution — inter-stage paths resolve from the
  prior entry run worktree; artifact `specPath` is the next-stage input surface.
- `v2/docs/first-workflow-walkthrough.md` § Configured pipeline — remove any implication that
  merging intent/plan PRs to `main` is required between stages; note approval gates are
  continue/stop only.
- `v2/docs/workflow-runner.md` — one paragraph on pipeline handoff vs standalone preset CLI
  (standalone `plan --ready-intent` still reads from cwd; pipeline reads from prior worktree).

## Prerequisites

- Durable pipeline stage artifacts (`pipeline-stage-dispatch.ts`) with `entryRunId` and `specPath`
- `pipeline-stage-resolve.ts` posture→preset mapping and prior-stage walk
- Git-enabled intent/plan publication landing on external worktrees
