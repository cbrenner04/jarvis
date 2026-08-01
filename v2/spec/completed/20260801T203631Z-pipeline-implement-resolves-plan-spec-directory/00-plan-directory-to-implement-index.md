# 00 - Plan directory to implement index normalization

## Problem

Plan completion records worktree-relative `specPath` as the spec **directory** (`publication-landing.ts` `landPlanTree`, `publication-workflow-steps.ts` `specPath: durableSpecPath`). Chained implement resolution passes that path through unchanged; `resolveImplementArtifact` rejects non-`index.md` paths with `Non-index spec requires --artifact` during preset build — before any workflow run row exists.

## Surface

Primary: `v2/src/daemon/pipeline-stage-resolve.ts` `resolveImplementStage` — normalize `prior.specPath` **before** the custom-builder vs preset-builder fork. In-scope: `pipeline-stage-resolve.test.ts` regressions; operator docs. Out of scope: plan publication shape, intent/plan handoff, external/no-commit plan specs (`~/.jarvis/specs/…`, not on the prior worktree), fan-out claim contention (`seeds/pipeline-fanout-stage-dispatch-contends-on-the-prior-worktree`).

## Decisions

- Plan→implement handoff normalizes directory `specPath` to `<dir>/index.md` in `resolveImplementStage` for chained presets with no `--artifact` — rules out requiring operator `--artifact` on a chained stage.
- Normalization runs in `resolveImplementStage` on `prior.specPath` before the builder fork — rules out `resolveImplementArtifact` (standalone preflight) or split guards across stage resolution and implement preflight.
- Directory `specPath` without `index.md` on the prior worktree fails at resolution with `pipeline-stage-resolve:` prefix, a worktree-relative resolved path, and wording that an index was expected — rules out bare `Non-index spec requires --artifact` from the implement builder on chained handoff.
- Already-`index.md` `specPath` passes through unchanged — rules out re-joining or overwriting an existing index path.
- Regression fixtures feed resolution the bare directory shape plan records today — rules out fixtures that pre-correct to `index.md` and mask the handoff bug.
- Plan directory recording and prior-worktree read root are unchanged — rules out reshaping plan landing or `resolvePriorArtifactContext` in this slice.
- Out of scope: external/no-commit plan pipelines; fan-out claim contention and terminal-state defects in `seeds/pipeline-fanout-stage-dispatch-contends-on-the-prior-worktree`.

## Prerequisites

- Inter-stage chained resolution reads artifact paths from the prior stage entry-run worktree, not `PipelineContext.cwd` (`resolvePriorArtifactContext`, `pipeline-stage-resolve.test.ts`).
- Plan stage completion records worktree-relative `specPath` as the spec directory on the stage artifact (`landPlanTree`, `pipeline-stage-dispatch.ts`).
- `resolveStageWorkflowSteps` maps a realizable implement stage to the implement preset builder using the prior plan artifact's `specPath` (`resolveImplementWorkflowStage`).
- Stage resolution failures are recorded on the stage row as `failure_detail` before any workflow run row is created (`failWorkflowStageAt` in `advanceWorkflowStage`).

## Task checklist

- [ ] Add directory→`index.md` guard in `resolveImplementStage` before the builder fork (one-line comment at the guard).
- [ ] Directory `specPath` on prior worktree with `index.md` → bind implement preset input `specPath` to `<dir>/index.md`, omit `artifactPath`.
- [ ] Directory without `index.md` → `{ ok: false, error }` with `pipeline-stage-resolve:` prefix, worktree-relative resolved path, index-expected wording.
- [ ] `index.md` artifact path → pass through unchanged.
- [ ] Add `pipeline-stage-resolve.test.ts` regressions per acceptance criteria; mutation-checkpoint comments name each inverted guard.
- [ ] Update operator docs per acceptance criteria.

## Acceptance criteria

- [x] `pipeline-stage-resolve.test.ts` — resolving `implement` with prior plan artifact `specPath` set to a bare spec directory (fixture includes `index.md` on the plan worktree only) yields implement preset input `specPath` `<dir>/index.md`, no `artifactPath`, `cwd` set to the prior entry-run worktree, and `baseRef` set to the prior branch; fixture uses the recorded directory shape unchanged; fails against the baseline; inverting the directory→index guard makes this test fail (source mutation on the real guard; pinning test comment names that mutation).
- [x] `pipeline-stage-resolve.test.ts` — resolving `implement` when the prior artifact already names `index.md` still succeeds with that path unchanged; fails against the baseline if directory normalization overwrites an existing index path; inverting the pass-through guard makes this test fail (source mutation on the real guard; pinning test comment names that mutation).
- [x] `pipeline-stage-resolve.test.ts` — a prior directory artifact without `index.md` on the prior worktree fails with `pipeline-stage-resolve:` prefix, a worktree-relative resolved path, and wording that an index was expected (not `Non-index spec requires --artifact`); inverting the directory→index guard makes this test fail (source mutation on the real guard; pinning test comment names that mutation).
- [x] `pipeline-stage-resolve.test.ts` — `"implement stage resolves chained specPath from the plan entry-run worktree with prior branch as baseRef"` stays green.
- [x] `v2/docs/operator-runbook.md` — pipeline section: plan hands implement a bare spec directory; chained resolution normalizes to `<dir>/index.md`; resolution failure before any run row (stage `failure_detail`, no workflow run).
- [x] `v2/docs/v1-behaviors.md` — pipeline inter-stage handoff entry (~line 223): replace pass-through `specPath` with plan directory artifact → implement `<dir>/index.md`; record resolution-time failure shape (`pipeline-stage-resolve:` prefix, resolved path, index expected).
- [x] `v2/docs/daemon-host.md` — Seed/artifact hand-off: implement chained resolution normalizes directory `specPath` to `<dir>/index.md` in `resolveImplementStage` (not pass-through); cross-link operator-runbook for pre-run failure symptoms.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — pipeline section (see acceptance criteria).
- `v2/docs/v1-behaviors.md` — pipeline inter-stage handoff entry (~line 223).
- `v2/docs/daemon-host.md` — Seed/artifact hand-off.
