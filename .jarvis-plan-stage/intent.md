---
name: pipeline-stage-settlement-honesty
---

# Stage settlement can terminalize a live run, downgrade run errors, and die on a merged base branch

Settlement liveness, base-ref retarget, and stage failure mirroring touch three module-boundary surfaces (`pipeline-stage-dispatch` settlement, completion publication base handling, stage `failureDetail` shaping in `pipeline-execution` / settlement). Plan should split into atomic subspecs in dependency order (settlement liveness → base retarget → failure mirroring / guard deletion) unless planning ties them to one independently shippable behavior.

## Problem

`applyEntryRunSettlement` writes `failed` and `endedAt` on any non-`completed` rollup without re-checking `isLiveEntryRun`. `waitForWorkflowEntryRun` can resolve that rollup without awaiting when no workflow promise is registered — the cross-process adopt path after restart — so a live entry run is terminalized and `startedAt == endedAt` can still occur. `failWorkflowStageAt` carries a live-linkage guard no call site can reach.

A `full-review` implement stage opens its draft PR with `--base <plan stage branch>`. Merging the plan PR deletes that base ref; `gh pr create` fails and the stage records `harness_failure` / `stop` while the owning run reports `completion_commit_failed` / `resume`.

## Decisions

- `applyEntryRunSettlement` re-checks `isLiveEntryRun` immediately before writing a non-success terminal patch and declines to terminalize a still-live run — rules out `wait` resolving non-`completed` over a live entry run and stamping `endedAt`.
- Declined settlement leaves the stage `running` without `endedAt` and records `failureDetail: { code: "settlement_deferred", reason: "entry_run_still_live", entryRunId, rollupStatus }` until a later settlement attempt succeeds or the entry run actually settles — rules out silently `running` forever with no operator-visible signal in `pipeline list`.
- Deferred to first consumer: fix `waitForWorkflowEntryRun` at its source vs defensive settlement re-check — pin when planning chooses the contract repair.
- Delete the inert `failWorkflowStageAt` live-linkage guard — rules out retaining a guard no mutation can kill.
- **Repository base** means `getBaseBranch(projectRoot)` — GitHub default branch via `gh repo view`, falling back to `main` when unavailable; same resolver plan/intent publication already uses.
- An implement stage whose configured base ref no longer exists on `origin` publishes against the repository base; the retarget is recorded on the stage artifact — rules out a merged intermediate PR killing the pipeline.
- A stage failure reason is derived from its owning run's operator error — rules out `harness_failure` / `stop` over a run that is `resumable: true`.
- The stacked-PR chain (implement based on the plan stage branch) and merge-order constraint are stated in pipeline documentation — rules out an operator learning it from a failed pipeline.
- Out of scope: concurrent sibling dispatch, dispatch claim window, `derivePipelineState` terminality, stage-to-run linkage identity (#2590/#2591).

## Acceptance criteria

- [ ] `pipeline-stage-dispatch.test.ts` — `"non-success settlement declines to terminalize a still-live entry run"` fails against the current writer, which terminalizes unconditionally.
- [ ] `pipeline-stage-dispatch.test.ts` — `"non-success settlement mirrors composeRunOperatorError from terminal log context"` stays green.
- [ ] `pipeline-stage-dispatch.test.ts` — `"adopt settlement does not terminalize when wait resolves non-completed over a still-live entry run"` fails against the current writer — cross-process path through `waitForWorkflowEntryRun`, not a stubbed `wait`.
- [ ] No stage row can be written with `endedAt` equal to its own `startedAt` while its linked entry run is live.
- [ ] `failWorkflowStageAt` has no live-linkage guard — the unreachable `running` + live-link branch is deleted.
- [ ] `completion-publisher.test.ts` — `"retargets PR base to repository base when requested base ref is absent from remote"` fails against the baseline `gh pr create` invocation and asserts the resolved base.
- [ ] The retarget is recorded on the stage artifact (or its failure detail when it still fails), naming both the requested and resolved base.
- [ ] A base ref that exists on `origin` is still used unchanged — no unconditional retarget to the repository base.
- [ ] `pipeline-execution.test.ts` — `"stage failureDetail mirrors owning run operator error for completion_commit_failed"` fails against the current writer, which records `harness_failure` / `stop`.
- [ ] Declined settlement records `failureDetail.code: "settlement_deferred"` while the stage stays `running` without `endedAt`; `pipeline-stage-dispatch.test.ts` — `"non-success settlement declines to terminalize a still-live entry run"` asserts the deferred detail.
- [ ] `pipeline-stage-dispatch.test.ts` — `"non-success settlement declines to terminalize a still-live entry run"`: `// @mutate` removing the settlement liveness re-check turns the pinning regression RED.
- [ ] `completion-publisher.test.ts` — `"retargets PR base to repository base when requested base ref is absent from remote"`: `// @mutate` removing the base-existence check turns the pinning regression RED.
- [ ] `bun run typecheck`, `bun run check`, `bun run test:v2`, and `bun run test:integration:v2` exit zero.

## Documentation updates

- `v2/docs/daemon-host.md` — settlement declines to terminalize a live entry run (including `paused` entry runs, which are not terminal and read as live); what `wait` guarantees and what it does not; declined settlement `failureDetail`; stage failure reasons mirror the owning run's operator error.
- `v2/docs/v1-behaviors.md` — same settlement liveness, deferred-settlement visibility, failure mirroring, and base-retarget behavior changes for pipeline stage rows.
- `v2/docs/operator-runbook.md` — § Pipeline start — implement stacks on the plan stage branch, what happens if that branch merges first, and the retarget behavior.

## Prerequisites

- `liveLinkedEntryRunId`, `adoptAndSettlePipelineStage`, and live-linkage guards from stage entry-run linkage (#2566) are shipped.
- Pipeline stage dispatch resolves each stage's base ref and passes it to workflow admission (`pipeline-stage-resolve.ts`, `pipeline-execution.ts`).
