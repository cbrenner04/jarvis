---
name: pipeline-branch-keyed-stage-records
---

# Pipeline stage persistence is branch-keyed and carries multiple downstream inputs

## Problem

Durable pipeline stages are one row per `stageId`. A splitting intent needs independent lifecycle,
artifact, and gate state per ready-intent branch with no cross-branch overwrite.

## Decisions

- Durable stage rows are keyed by `(stageId, branchKey)` where `branchKey` identifies the originating downstream input — rules out one row per `stageId` and rules out implicit default-only branching.
- A succeeded workflow-stage artifact may record multiple downstream inputs, each a worktree-relative ready-intent file path — rules out a single `specPath` field only and rules out retaining the ready-intents directory as the handoff value for splits.
- `listPipelines` / `loadPipeline` return every branch row for a pipeline — rules out collapsing branches in persistence reads.
- Branch creation is explicit at the fan-out boundary; this slice does not run downstream stages — rules out absorbing execution-loop or daemon fan-out logic here.
- Schema migration backfills existing single-row-per-`stageId` records with constant `branchKey` `"default"` — rules out null keys and path-derived backfill before fan-out lands.
- Deferred to fan-out execution: stable path-derived `branchKey` for new branches beyond the migration default.

## Acceptance criteria

- [ ] `state-store.test.ts` — two branch rows for the same `stageId` persist distinct `branchKey`, status, and artifact payloads; collapsing to one row per `stageId` makes the test fail.
- [ ] `state-store.test.ts` — a stage artifact with two downstream-input file paths round-trips through write and read; storing only one path or a directory path makes the test fail.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` § Pipeline stage resolution — stage artifacts may carry multiple downstream inputs; durable records are keyed by branch.
- `v2/docs/v1-behaviors.md` — record branch-keyed pipeline stage persistence.

## Prerequisites

- Durable pipeline stage records, approval gates, and `pipeline list` / `wait` / `approve` / `reject` / `resume` exist.
- Inter-stage handoff resolves chained inputs from the prior entry-run worktree.
- Intent completion records a concrete ready-intent file on the entry run and stage artifact when landing produces exactly one ready-intent file; the ready-intents directory when landing produces more than one.
