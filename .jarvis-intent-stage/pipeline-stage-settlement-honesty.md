---
name: pipeline-stage-settlement-honesty
---

# Stage settlement can terminalize a live run, downgrade run errors, and die on a merged base branch

Settlement liveness, base-ref retarget, and stage failure mirroring all change what a pipeline stage row records when its linked run settles or fails — one daemon seam; splitting does not apply.

## Problem

`applyEntryRunSettlement` writes `failed` and `endedAt` on any non-`completed` rollup without re-checking `isLiveEntryRun`. `waitForWorkflowEntryRun` can resolve that rollup without awaiting when no workflow promise is registered — the cross-process adopt path after restart — so a live entry run is terminalized and `startedAt == endedAt` can still occur. `failWorkflowStageAt` carries a live-linkage guard no call site can reach.

A `full-review` implement stage opens its draft PR with `--base <plan stage branch>`. Merging the plan PR deletes that base ref; `gh pr create` fails and the stage records `harness_failure` / `stop` while the owning run reports `completion_commit_failed` / `resume`.

## Decisions

- `applyEntryRunSettlement` re-checks `isLiveEntryRun` immediately before writing a non-success terminal patch and declines to terminalize a still-live run — rules out `wait` resolving non-`completed` over a live entry run and stamping `endedAt`.
- The declined settlement case is reported so a stage that cannot settle is visible — rules out silently `running` forever.
- Deferred to first consumer: fix `waitForWorkflowEntryRun` at its source vs defensive settlement re-check — pin when planning chooses the contract repair.
- Delete the inert `failWorkflowStageAt` live-linkage guard — rules out retaining a guard no mutation can kill.
- An implement stage whose configured base ref no longer exists on the remote publishes against the repository base; the retarget is recorded on the stage artifact — rules out a merged intermediate PR killing the pipeline.
- A stage failure reason is derived from its owning run's operator error — rules out `harness_failure` / `stop` over a run that is `resumable: true`.
- The stacked-PR chain (implement based on the plan stage branch) and merge-order constraint are stated in pipeline documentation — rules out an operator learning it from a failed pipeline.
- Out of scope: concurrent sibling dispatch, dispatch claim window, `derivePipelineState` terminality, stage-to-run linkage identity (#2590/#2591).

## Acceptance criteria

- [ ] A non-`completed` rollup for an entry run that is still live does not write `failed` or `endedAt` on the stage; a regression fails against the current writer, which terminalizes unconditionally.
- [ ] A non-`completed` rollup for a genuinely settled entry run still records the composed operator error exactly as today.
- [ ] A stage adopted after daemon restart, whose entry run has no registered workflow promise, is not terminalized while that run is live — the cross-process path, driven through `waitForWorkflowEntryRun` rather than a stubbed `wait`.
- [ ] No stage row can be written with `endedAt` equal to its own `startedAt` while its linked entry run is live.
- [ ] `failWorkflowStageAt` has no unreachable live-linkage guard: either it is removed, or a regression constructs a call reaching it with a `running` record.
- [ ] An implement stage whose base branch is absent from the remote publishes against the repository base instead of failing; a regression fails against the baseline `gh pr create` invocation and asserts the resolved base.
- [ ] The retarget is recorded on the stage artifact (or its failure detail when it still fails), naming both the requested and resolved base.
- [ ] A base ref that exists is still used unchanged — no unconditional retarget to the repository base.
- [ ] A stage whose owning run settled a retryable operator error reports that reason and `nextAction` on the stage row rather than `harness_failure` / `stop`; a regression covers the `completion_commit_failed` case.
- [ ] Mutation checkpoints: `// @mutate` directives removing the settlement liveness re-check and removing the base-existence check each turn their pinning regression RED.
- [ ] `bun run typecheck`, `bun run check`, `bun run test:v2`, and `bun run test:integration:v2` exit zero.

## Documentation updates

- `v2/docs/daemon-host.md` — settlement declines to terminalize a live entry run; what `wait` guarantees and what it does not; stage failure reasons mirror the owning run's operator error.
- `v2/docs/operator-runbook.md` — correct the "stays `running` until the entry run settles" claim for `paused` runs (not terminal, so they read as live); § Pipeline start — implement stacks on the plan stage branch, what happens if that branch merges first, and the retarget behavior.

## Prerequisites

- `liveLinkedEntryRunId`, `adoptAndSettlePipelineStage`, and live-linkage guards from stage entry-run linkage (#2566) are shipped.
- Pipeline stage dispatch resolves each stage's base ref and passes it to workflow admission (`pipeline-stage-resolve.ts`, `pipeline-execution.ts`).
