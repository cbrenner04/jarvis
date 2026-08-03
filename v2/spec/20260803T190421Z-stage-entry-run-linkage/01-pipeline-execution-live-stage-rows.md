# Pipeline execution live stage rows

## Problem

The ordered progression loop can terminalize or overwrite a `running` stage row while `workflowInvocationId` still names a live entry run — e.g. fan-out `worktree_claimed` from a prior stage's workflow, or `startedAt == endedAt` with a stale invocation id.

## Surface

Primary: `v2/src/daemon/pipeline-execution.ts`. In-scope: `pipeline-execution.test.ts`. Depends on subspec 00.

## Prerequisites

- Subspec 00 landed: `dispatchPipelineStage` holds live linkage and mirrors operator errors at settlement.

## Decisions

- **Still-live entry run:** `isLiveEntryRun(store, entryRunId)` — `store.loadRun(entryRunId)` exists and `!isTerminalRunStatus(run.status)`. Same operational predicate dispatch `wait` uses for settlement; a non-terminal loaded run status means the entry run has not settled.
- While `workflowInvocationId` names a still-live entry run, a `running` stage row must not be terminalized or overwritten — no premature `failed`, no `endedAt` (addressing `startedAt == endedAt`), no clearing or replacing `workflowInvocationId`, and no other terminal patch. Rules out fan-out siblings, claim races, or reconciliation writing over an in-flight admitted stage.
- **Writers that honor the invariant** (guard before any terminal `updateStage` on a live-linked `running` row): ordered progression re-entry (`runAuthoredStages` / `advanceWorkflowStage`), fan-out branch continuation (`advanceFanOutStageResolution`), `failWorkflowStageAt`, `failStrandedPipelineStage`, and the `advanceWorkflowStage` catch handler.
- **Carved out:** pre-run dispatch refusal and dispatch settlement (subspec 00); `skipRemainingStages` (skips only, does not terminalize a live-linked row); approval-boundary failures on approval rows (no `workflowInvocationId` linkage).
- Out of scope: `derivePipelineState` terminality, retry/backoff, `multiple_failed_stages` resume refusal.

## Task checklist

- Introduce shared `isLiveEntryRun` (or import from dispatch) and guard the listed writers before terminal `updateStage` on a live-linked `running` row.
- Port fan-out live-linkage regression from PR #2555: `re-entry skips already-running fan-out branch rows without re-dispatch` (**exclude** `v2/spec/20260803T002657Z-fan-out-stage-dispatch-preserves-workflow-ownership/`).
- Add a fan-out-shaped regression: admitted entry run still live (deferred settlement), stage must not terminalize, stamp `endedAt`, or replace `workflowInvocationId` until that run settles; distinguish post-admission linkage from pre-run refusal (`worktree_claimed` with no linkage).
- Pin `// @mutate` on the shared live-link guard: `// @mutate v2/src/daemon/pipeline-execution.ts "if (isLiveEntryRun(store, record.workflowInvocationId)) return record.workflowInvocationId;" -> "if (false) return record.workflowInvocationId;"`
- Update operator docs and v1 parity catalog.

## Acceptance criteria

- [ ] `pipeline-execution.test.ts` — while `workflowInvocationId` names a still-live entry run, the stage row stays `running` with linkage and timestamps intact — no premature `failed`, no `endedAt`, no clearing or replacing `workflowInvocationId`; the live-guard `// @mutate` directive above makes the regression fail against baseline.
- [ ] `pipeline-execution.test.ts` — fan-out re-entry with a deferred-settlement admitted entry run does not terminalize or stamp terminal timestamps until that run settles; pre-run `worktree_claimed` refusal remains unlinked (subspec 00).
- [ ] `bun run typecheck`, `bun run check`, `bun run lint:md`, `bun run test:v2`, and `bun run test:integration:v2` exit zero.

## Documentation updates

- `v2/docs/operator-runbook.md` — a `failed` stage never names a live invocation.
- `v2/docs/v1-behaviors.md` — record changed v2 stage linkage behavior.
