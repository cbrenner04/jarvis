# Resolve stage fan-out

## Problem

After a splitting intent, `resolveStageWorkflowSteps` resolves plan (and later chained stages) from the prior artifact's single `specPath` only. Multi-file intent artifacts carry `downstreamInputs`, but resolution ignores them, so only one ready-intent can reach plan.

## Surface

Primary: `v2/src/daemon/pipeline-stage-resolve.ts`. In-scope: `pipeline-stage-resolve.test.ts`; `PipelineStageArtifact` / `downstreamInputs` typing at dispatch boundaries only as needed for fixtures.

## Prerequisites

- Inter-stage handoff resolves chained inputs from the prior entry-run worktree (`v2/spec/completed/20260730T225359Z-pipeline-stage-resolve-prior-worktree/`).
- Multi-file intent landing records one `downstreamInputs` entry per landed ready-intent file on the entry run and stage artifact (`intent-output.ts`, `pipeline-stage-dispatch.test.ts`).
- Single-file intent handoff records a concrete ready-intent file `specPath` with no `downstreamInputs` (`v2/spec/completed/20260730T221214Z-pipeline-intent-artifact-ready-intent-file/`).

## Decisions

- When the nearest preceding workflow artifact carries `downstreamInputs` with length ≥ 2, chained plan/implement resolution fans out one successful preset binding per listed file path — rules out resolving only `specPath` or the first array element.
- Each fan-out entry binds `readyIntent` / chained `specPath` to one concrete worktree-relative file from `downstreamInputs`; preset `cwd` stays the prior entry-run worktree — rules out directory `specPath` passthrough for multi-file handoff.
- Single-file handoff (no `downstreamInputs`, file-shaped `specPath`) keeps today's one-resolution behavior — rules out fan-out when N=1.
- Fan-out applies only to stages chained after the splitting workflow stage; the intent stage itself stays one dispatch on `default` — rules out fan-out from plan or other non-splitting stages.
- Deferred to first consumer: exported multi-resolution return type and caller wiring in `advanceWorkflowStage` — pin in subspec 01 when execution consumes fan-out results.

## Task checklist

- Extend chained plan/implement resolution to iterate `downstreamInputs` when present on the prior workflow artifact.
- Add `pipeline-stage-resolve.test.ts` fixtures: intent-stage artifact with N=2 `downstreamInputs`, prior worktree files for both paths, fake builders capturing preset inputs.
- Add negative coverage: collapsing fan-out to the first input fails; missing downstream file fails without falling back to directory `specPath`.
- Update `v2/docs/daemon-host.md` § Pipeline stage resolution for multi-input resolution.

## Acceptance criteria

- [ ] `pipeline-stage-resolve.test.ts` — after a splitting intent artifact with N=2 `downstreamInputs`, resolving the plan stage returns two `ok` resolutions with distinct `readyIntent` files; collapsing to the first input makes the test fail.
- [ ] `pipeline-stage-resolve.test.ts` — single-file prior artifact (file `specPath`, no `downstreamInputs`) still returns one `ok` resolution; inverting the no-fan-out-when-absent guard makes the test fail.
- [ ] `bun run typecheck` exits zero.

## Documentation updates

- `v2/docs/daemon-host.md` § Pipeline stage resolution — when a splitting-stage artifact carries `downstreamInputs`, chained resolution binds one preset input per listed ready-intent file; single-file handoff is unchanged.
