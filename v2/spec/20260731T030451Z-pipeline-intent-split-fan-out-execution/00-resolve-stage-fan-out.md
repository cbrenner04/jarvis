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

- Fan-out triggers only on the first chained stage after a splitting artifact: when the nearest preceding workflow artifact carries `downstreamInputs` with length ≥ 2, that stage's resolution yields one successful preset binding per listed file path — rules out resolving only `specPath` or the first array element.
- Later chained stages (e.g., implement after per-branch plan) resolve from the branch-local preceding artifact on that `branchKey`; they do not re-iterate intent `downstreamInputs` — rules out re-fan-out on every downstream stage.
- When `downstreamInputs` is present with length 1, resolution returns one `ok` result bound to that path — rules out rejecting length-1 arrays or treating them as multi-resolution fan-out.
- Each fan-out entry binds `readyIntent` / chained `specPath` to one concrete worktree-relative file from `downstreamInputs`; preset `cwd` stays the prior entry-run worktree — rules out directory `specPath` passthrough for multi-file handoff.
- Single-file handoff (no `downstreamInputs`, file-shaped `specPath`) and single-file plan handoff on a branch (file `specPath`, no `downstreamInputs`) each keep one-resolution behavior — rules out fan-out when N=1.
- `resolveStageWorkflowSteps` returns multiple results (one per downstream input) when fan-out applies; production caller fan-out wiring in `advanceWorkflowStage` lands in subspec 01 — rules out leaving the return shape or caller contract ambiguous in this slice.
- Fan-out applies only to stages chained after the splitting workflow stage; the intent stage itself stays one dispatch on `default` — rules out fan-out from plan or other non-splitting stages.
- A listed `downstreamInputs` path absent from the prior worktree fails resolution without falling back to directory `specPath` — rules out silent directory passthrough on missing files.

## Task checklist

- Extend first-chained-stage resolution to iterate `downstreamInputs` when length ≥ 2; export multi-result return type.
- Keep later chained stages on branch-local preceding artifacts (single resolution per call).
- Add `pipeline-stage-resolve.test.ts` fixtures: intent-stage artifact with N=2 `downstreamInputs`, prior worktree files for both paths, fake builders capturing preset inputs.
- Add negative coverage: collapsing fan-out to the first input fails; missing downstream file fails without falling back to directory `specPath`.
- Update `v2/docs/daemon-host.md` § Pipeline stage resolution for multi-input resolution (slug: `pipeline-intent-split-fan-out-execution`).

## Acceptance criteria

- [ ] `pipeline-stage-resolve.test.ts` — after a splitting intent artifact with N=2 `downstreamInputs`, resolving the plan stage returns two `ok` resolutions with distinct `readyIntent` files; collapsing to the first input makes the test fail.
- [ ] `pipeline-stage-resolve.test.ts` — single-file prior artifact (file `specPath`, no `downstreamInputs`) still returns one `ok` resolution; inverting the no-fan-out-when-absent guard makes the test fail.
- [ ] `pipeline-stage-resolve.test.ts` — per-branch plan artifact (file `specPath`, no `downstreamInputs`) resolving implement returns one `ok` resolution; inverting the no-refan-out guard makes the test fail.
- [ ] `pipeline-stage-resolve.test.ts` — `downstreamInputs` length 1 returns one `ok` resolution bound to that path; treating length 1 as multi-fan-out makes the test fail.
- [ ] `pipeline-stage-resolve.test.ts` — a listed `downstreamInputs` path missing from the worktree fails without falling back to directory `specPath`; inverting the no-fallback guard makes the test fail.
- [ ] `bun run typecheck` exits zero.

## Documentation updates

- `v2/docs/daemon-host.md` § Pipeline stage resolution — first chained stage after a splitting artifact fans out one preset per `downstreamInputs` entry; later stages resolve from branch-local artifacts; single-file handoff unchanged.
