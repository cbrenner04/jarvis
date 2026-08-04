# Branch-scoped stage artifacts

## Problem

In-memory `stageArtifacts` is keyed by `stageId` only. Fan-out branches that share one map during resolution can read or overwrite a sibling's preceding artifact depending on settle order.

## Surface

Primary: `v2/src/daemon/pipeline-stage-resolve.ts`, `v2/src/daemon/pipeline-execution.ts` (`carryForwardArtifact`, `buildBranchStageArtifacts`, `runAuthoredStages` artifact threading). In-scope: `pipeline-stage-resolve.test.ts`, `pipeline-execution.test.ts` fan-out helpers and artifact key usages.

## Prerequisites

- Stage linkage holds through settlement (`v2/spec/completed/20260803T190421Z-stage-entry-run-linkage/`).
- Chained resolution reads prior entry-run worktree and artifact fields (`v2/spec/completed/20260730T225359Z-pipeline-stage-resolve-prior-worktree/`).
- Fan-out resolution and per-branch durable rows exist (`v2/spec/completed/20260731T030451Z-pipeline-intent-split-fan-out-execution/`).

## Decisions

- In-memory `stageArtifacts` keys are `(stageId, branchKey)` — rules out `stageId`-only maps shared across branches.
- `findPrecedingWorkflowArtifact` and `carryForwardArtifact` take the active `branchKey` — rules out branch-blind artifact lookup on fan-out suffix stages.
- `advanceFanOutBranches` may share one composite-keyed `stageArtifacts` map (sibling writes are disjoint by `branchKey`) — rules out per-branch map splits at the first post-split dispatch site.
- Each fan-out suffix walk builds and mutates only its own artifact map (`buildBranchStageArtifacts` per branch); drop `sharedStageArtifacts` carry-forward into suffix `runAuthoredStages` — rules out one shared map spanning sibling suffix walks.
- Prefix stages before the split keep `branchKey: "default"` in the artifact map — rules out fan-out keying on pre-split stages.
- Keep `chainedInputRoot` ready-intent read-path behavior from PR #2555; do not reintroduce `destinationDistinctFromPredecessor`, `selectChainedStageCwd` ownership predicates, or `PriorArtifactContext.cwd` — rules out disproven destination-ownership guards.
- Out of scope: concurrent sibling dispatch (subspec 01), durable stage-admission claims (next intent).

## Task checklist

- Introduce a shared `(stageId, branchKey)` artifact map key helper; thread `branchKey` through `resolveStageWorkflowSteps`, `findPrecedingWorkflowArtifact`, `carryForwardArtifact`, and execution callers.
- Stop passing `sharedStageArtifacts` into fan-out suffix `runAuthoredStages`; each suffix branch owns its map from `buildBranchStageArtifacts`.
- Migrate fan-out tests to composite keys: update `fanOutResolveStageStub`, shared fan-out test helpers, and `stageArtifacts.get("` / `stageArtifacts.set("` usages in `pipeline-execution.test.ts` and `pipeline-stage-resolve.test.ts`.
- Add `pipeline-stage-resolve.test.ts` regression `"fan-out implement resolution binds active branchKey plan artifact when siblings populate out of order"`: one map holds branch A then branch B plan artifacts (controlled populate order); implement resolution on branch B binds branch B's plan artifact, not branch A's.
- Pin `// @mutate` on branch-scoped lookup in `findPrecedingWorkflowArtifact`.
- Pin `// @mutate` on dropping `sharedStageArtifacts` from suffix `runAuthoredStages` (re-pass the shared prefix map into suffix walks); the resolve regression above must go RED when suffix walks share one map.

## Acceptance criteria

- [x] `pipeline-stage-resolve.test.ts` — `"fan-out implement resolution binds active branchKey plan artifact when siblings populate out of order"` fails when lookup collapses to `stageId` only; linked `// @mutate` on `findPrecedingWorkflowArtifact` branch-scoped lookup makes the regression fail against baseline.
- [x] `pipeline-stage-resolve.test.ts` — `"fan-out implement resolution binds active branchKey plan artifact when siblings populate out of order"` fails when suffix `runAuthoredStages` reuses `sharedStageArtifacts`; linked `// @mutate` on the suffix shared-map guard makes that inversion fail.
- [x] `pipeline-stage-resolve.test.ts` — `"plan stage resolves through real preset builders when ready-intent exists only on intent worktree"` and `"implement stage resolves through real preset builders when plan spec exists only on plan worktree branch"` stay green (chainedInputRoot / ready-intent read path unchanged).
- [x] `bun run typecheck` exits zero.
- [x] `bun test v2/src/daemon/pipeline-stage-resolve.test.ts` exits zero.

## Documentation updates

- None — operator-facing in-memory artifact scoping and concurrent dispatch land in subspec 01 `daemon-host.md` / `v1-behaviors.md` updates.

## Blocker

Artifact contract check failed: Hollow mutation checkpoints (the named mutation left the scoped suite green):
- no @mutate directive linked to this criterion; add // @mutate <path> "<original>" -> "<replacement>" on the named pin
- no @mutate directive linked to this criterion; add // @mutate <path> "<original>" -> "<replacement>" on the named pin
