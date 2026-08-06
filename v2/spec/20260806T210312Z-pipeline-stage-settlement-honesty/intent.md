---
name: pipeline-stage-settlement-honesty
---

# Stage settlement can terminalize a live run, downgrade run errors, and die on a merged base branch

Settlement liveness, base-ref retarget, and stage failure mirroring touch three module-boundary surfaces (`pipeline-stage-dispatch` settlement, completion publication base handling, stage `failureDetail` shaping in `pipeline-execution` / settlement). Plan should split into atomic subspecs in dependency order (settlement liveness → base retarget → failure mirroring / guard deletion) unless planning ties them to one independently shippable behavior.

## Problem

`applyEntryRunSettlement` writes `failed` and `endedAt` on any non-`completed` rollup without re-checking `isLiveEntryRun`. `waitForWorkflowEntryRun` can resolve that rollup without awaiting when no workflow promise is registered — the cross-process adopt path after restart — so a live entry run is terminalized and premature non-success settlement can record `harness_failure` / `stop` before the entry run actually terminals. `failWorkflowStageAt` carries a live-linkage guard no call site can reach.

A `full-review` implement stage opens its draft PR with `--base <plan stage branch>`. Merging the plan PR deletes that base ref; `gh pr create` fails and the stage records `harness_failure` / `stop` while the owning run reports `completion_commit_failed` / `resume`.

## Decisions

- `applyEntryRunSettlement` re-checks `isLiveEntryRun` immediately before writing a non-success terminal patch and declines to terminalize a still-live run — rules out `wait` resolving non-`completed` over a live entry run and stamping `endedAt`.
- Declined settlement leaves the stage `running` without `endedAt` and records `failureDetail: { code: "settlement_deferred", reason: "entry_run_still_live", entryRunId, rollupStatus }` until a later settlement attempt succeeds or the entry run actually settles — rules out silently `running` forever with no operator-visible signal in `pipeline list`.
- Existing adopt/continue/recovery paths re-attempt settlement when the linked entry run is no longer live — rules out deferred `running` without a named retry seam.
- Deferred to first consumer: fix `waitForWorkflowEntryRun` at its source vs defensive settlement re-check — pin when planning chooses the contract repair; adopt-path tests use a mirror-primitive `wait` matching rollup semantics, not literal `waitForWorkflowEntryRun` integration.
- Delete the inert `failWorkflowStageAt` live-linkage guard — rules out retaining a guard no mutation can kill.
- **Repository base** means `getBaseBranch(projectRoot)` — GitHub default branch via `gh repo view`, falling back to `main` when unavailable; same resolver plan/intent publication already uses.
- An implement stage whose configured base ref no longer exists on `origin` publishes against the repository base through the full publication chain; the retarget is recorded on the stage artifact (`requestedBase` / `resolvedBase` on success, or on `failureDetail` when publication still fails) — rules out a merged intermediate PR killing the pipeline.
- After deferred settlement, terminal non-success `failureDetail` mirrors the owning entry run's `composeRunOperatorError` result — rules out `harness_failure` / `stop` on the eventual terminal patch when the run is `resumable: true` with `completion_commit_failed`.
- The stacked-PR chain (implement based on the plan stage branch) and merge-order constraint are stated in pipeline documentation — rules out an operator learning it from a failed pipeline.
- Out of scope: concurrent sibling dispatch, dispatch claim window, `derivePipelineState` terminality, stage-to-run linkage identity (#2590/#2591).

## Acceptance criteria

- [ ] `pipeline-stage-dispatch.test.ts` — `"non-success settlement declines to terminalize a still-live entry run"` fails against the current writer, which terminalizes unconditionally.
- [ ] `pipeline-stage-dispatch.test.ts` — `"non-success settlement mirrors composeRunOperatorError from terminal log context"` stays green.
- [ ] `pipeline-stage-dispatch.test.ts` — `"adopt settlement does not terminalize when wait resolves non-completed over a still-live entry run"` fails against the current writer — adopt/settlement through a mirror-primitive `wait` matching `waitForWorkflowEntryRun` rollup semantics (no in-flight promise; durable non-terminal entry run), not a stubbed `wait`.
- [ ] No stage row receives `failed` or `succeeded` while its linked entry run is live (`isLiveEntryRun`).
- [ ] `pipeline-stage-dispatch.test.ts` — `"deferred settlement re-settles with operator error when entry run later terminals"` fails against the current writer.
- [ ] `failWorkflowStageAt` has no live-linkage guard — the unreachable `running` + live-link branch is deleted.
- [ ] `completion-publisher.test.ts` — `"retargets PR base to repository base when requested base ref is absent from remote"` fails against the baseline publication chain and asserts the resolved base.
- [ ] The retarget is recorded on the stage artifact (or its `failureDetail` when publication still fails) with `requestedBase` and `resolvedBase` naming both bases.
- [ ] `completion-publisher.test.ts` — `"preserves requested base when branch exists on origin"` stays green.
- [ ] Declined settlement records `failureDetail.code: "settlement_deferred"` while the stage stays `running` without `endedAt`; `pipeline-stage-dispatch.test.ts` — `"non-success settlement declines to terminalize a still-live entry run"` asserts the deferred detail.
- [ ] `pipeline-stage-dispatch.test.ts` — `"non-success settlement declines to terminalize a still-live entry run"`: `// @mutate` removing the settlement liveness re-check turns the pinning regression RED.
- [ ] `completion-publisher.test.ts` — `"retargets PR base to repository base when requested base ref is absent from remote"`: `// @mutate` removing the base-existence check turns the pinning regression RED.
- [ ] `bun run typecheck`, `bun run check`, `bun run test:v2`, and `bun run test:integration:v2` exit zero.

## Documentation updates

- `v2/docs/daemon-host.md` — settlement declines to terminalize a live entry run (including `paused` entry runs and other non-terminal live statuses); what `wait` guarantees and what it does not; declined settlement `failureDetail`; re-settlement after deferral; `pipeline list` deferred-detail visibility; full-chain base retarget; stage failure reasons mirror the owning run's operator error after re-settlement.
- `v2/docs/v1-behaviors.md` — same settlement liveness, deferred-settlement visibility, re-settlement mirroring, and base-retarget behavior changes for pipeline stage rows.
- `v2/docs/operator-runbook.md` — § Pipeline start — implement stacks on the plan stage branch, what happens if that branch merges first, `ls-remote` fail-closed retarget, and the retarget behavior.

## Prerequisites

- `liveLinkedEntryRunId`, `adoptAndSettlePipelineStage`, and live-linkage guards from stage entry-run linkage (#2566) are shipped.
- Pipeline stage dispatch resolves each stage's base ref and passes it to workflow admission (`pipeline-stage-resolve.ts`, `pipeline-execution.ts`).
