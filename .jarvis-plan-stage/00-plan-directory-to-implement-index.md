# 00 - Plan directory to implement index normalization

## Problem

Plan completion records worktree-relative `specPath` as the spec **directory** (`publication-landing.ts` `landPlanTree`, `publication-workflow-steps.ts` `specPath: durableSpecPath`). Chained implement resolution passes that path through unchanged; `resolveImplementArtifact` rejects non-`index.md` paths with `Non-index spec requires --artifact` during preset build — before any workflow run row exists.

## Surface

Primary: `v2/src/daemon/pipeline-stage-resolve.ts` (`resolveImplementWorkflowStage` / `resolveImplementStage`, or `v2/src/execution/implement-workflow-steps.ts` `resolveImplementArtifact` — pin one). In-scope: `pipeline-stage-resolve.test.ts` regressions; operator docs. Out of scope: plan publication shape, intent/plan handoff, fan-out claim contention (`seeds/pipeline-fanout-stage-dispatch-contends-on-the-prior-worktree`).

## Decisions

- Plan→implement handoff normalizes directory `specPath` to `<dir>/index.md` at chained implement stage resolution for presets with no `--artifact` — rules out requiring operator `--artifact` on a chained stage.
- Deferred to first consumer: whether normalization runs in `resolveImplementStage` or `resolveImplementArtifact` — pin when implementing.
- Normalization lands in exactly one of those functions, not both in one review — rules out split guards across stage resolution and implement preflight.
- Prior artifact that is neither a directory containing `index.md` on the prior worktree nor a path whose basename is `index.md` fails at resolution naming the resolved path and that an index was expected — rules out surfacing bare `Non-index spec requires --artifact` from the implement builder on chained handoff.
- Already-`index.md` `specPath` passes through unchanged — rules out re-joining or overwriting an existing index path.
- Regression fixtures feed resolution the bare directory shape plan records today — rules out fixtures that pre-correct to `index.md` and mask the handoff bug.
- Plan directory recording and prior-worktree read root are unchanged — rules out reshaping plan landing or `resolvePriorArtifactContext` in this slice.
- Out of scope: fan-out claim contention and terminal-state defects in `seeds/pipeline-fanout-stage-dispatch-contends-on-the-prior-worktree`.

## Prerequisites

- Inter-stage chained resolution reads artifact paths from the prior stage entry-run worktree, not `PipelineContext.cwd` (`resolvePriorArtifactContext`, `pipeline-stage-resolve.test.ts`).
- Plan stage completion records worktree-relative `specPath` as the spec directory on the stage artifact (`landPlanTree`, `pipeline-stage-dispatch.ts`).
- `resolveStageWorkflowSteps` maps a realizable implement stage to the implement preset builder using the prior plan artifact's `specPath` (`resolveImplementWorkflowStage`).
- Stage resolution failures are recorded on the stage row as `failure_detail` before any workflow run row is created (`failWorkflowStageAt` in `advanceWorkflowStage`).

## Task checklist

- [ ] Pin normalization site: `resolveImplementStage` or `resolveImplementArtifact` (document choice in a one-line comment at the guard).
- [ ] Directory `specPath` on prior worktree with `index.md` → bind implement preset input `specPath` to `<dir>/index.md`, omit `artifactPath`.
- [ ] Directory without `index.md` → `{ ok: false, error }` at resolution naming resolved path and index expectation.
- [ ] `index.md` artifact path → pass through unchanged.
- [ ] Add `pipeline-stage-resolve.test.ts` regressions per acceptance criteria; mutation-checkpoint comments name each inverted guard.
- [ ] Update `v2/docs/operator-runbook.md`, `v2/docs/v1-behaviors.md`, `v2/docs/daemon-host.md` per documentation updates.

## Acceptance criteria

- [ ] `pipeline-stage-resolve.test.ts` — resolving `implement` with prior plan artifact `specPath` set to a bare spec directory (fixture includes `index.md` on the plan worktree only) yields implement preset input `specPath` `<dir>/index.md` and no `artifactPath`; fixture uses the recorded directory shape unchanged; fails against the baseline; inverting the directory→index guard makes this test fail (source mutation on the real guard; pinning test comment names that mutation).
- [ ] `pipeline-stage-resolve.test.ts` — resolving `implement` when the prior artifact already names `index.md` still succeeds with that path unchanged; fails against the baseline if directory normalization overwrites an existing index path.
- [ ] `pipeline-stage-resolve.test.ts` — a prior directory artifact without `index.md` on the prior worktree fails with a message naming the resolved path and that an index was expected; inverting the directory→index guard makes this test fail (source mutation on the real guard; pinning test comment names that mutation).
- [ ] `pipeline-stage-resolve.test.ts` — `"implement stage resolves chained specPath from the plan entry-run worktree with prior branch as baseRef"` stays green.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- [ ] `v2/docs/operator-runbook.md` — pipeline section: plan hands implement a bare spec directory; chained resolution normalizes to `<dir>/index.md`; resolution failure before any run row (stage `failure_detail`, no workflow run).
- [ ] `v2/docs/v1-behaviors.md` — pipeline inter-stage handoff entry (~line 223): replace pass-through `specPath` with plan directory artifact → implement `<dir>/index.md`; record resolution-time failure shape (resolved path, index expected).
- [ ] `v2/docs/daemon-host.md` — Seed/artifact hand-off: implement chained resolution normalizes directory `specPath` to `<dir>/index.md` at stage resolution (not pass-through); cross-link operator-runbook for pre-run failure symptoms.
