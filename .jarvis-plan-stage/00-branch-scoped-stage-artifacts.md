# Branch-scoped stage artifacts

## Problem

In-memory `stageArtifacts` is keyed by `stageId` only. Fan-out branches that share one map during resolution can read or overwrite a sibling's preceding artifact depending on settle order.

## Surface

Primary: `v2/src/daemon/pipeline-stage-resolve.ts`, `v2/src/daemon/pipeline-execution.ts` (`carryForwardArtifact`, `buildBranchStageArtifacts`, `runAuthoredStages` artifact threading). In-scope: `pipeline-stage-resolve.test.ts`, `pipeline-execution.test.ts` only where needed to keep artifact keying green.

## Prerequisites

- Stage linkage holds through settlement (`v2/spec/completed/20260803T190421Z-stage-entry-run-linkage/`).
- Chained resolution reads prior entry-run worktree and artifact fields (`v2/spec/completed/20260730T225359Z-pipeline-stage-resolve-prior-worktree/`).
- Fan-out resolution and per-branch durable rows exist (`v2/spec/completed/20260731T030451Z-pipeline-intent-split-fan-out-execution/`).

## Decisions

- In-memory `stageArtifacts` keys are `(stageId, branchKey)` — rules out `stageId`-only maps shared across branches.
- `findPrecedingWorkflowArtifact` and `carryForwardArtifact` take the active `branchKey` — rules out branch-blind artifact lookup on fan-out suffix stages.
- Each fan-out suffix walk builds and mutates only its own artifact map (`buildBranchStageArtifacts` per branch); drop `sharedStageArtifacts` carry-forward into suffix `runAuthoredStages` — rules out one shared map spanning sibling suffix walks.
- Prefix stages before the split keep `branchKey: "default"` in the artifact map — rules out fan-out keying on pre-split stages.
- Keep `chainedInputRoot` ready-intent read-path behavior from PR #2555; do not reintroduce `destinationDistinctFromPredecessor`, `selectChainedStageCwd` ownership predicates, or `PriorArtifactContext.cwd` — rules out disproven destination-ownership guards.
- Out of scope: concurrent sibling dispatch (subspec 01), durable stage-admission claims (next intent).

## Task checklist

- Introduce a shared `(stageId, branchKey)` artifact map key helper; thread `branchKey` through `resolveStageWorkflowSteps`, `findPrecedingWorkflowArtifact`, `carryForwardArtifact`, and execution callers.
- Stop passing `sharedStageArtifacts` into fan-out suffix `runAuthoredStages`; each suffix branch owns its map from `buildBranchStageArtifacts`.
- Add `pipeline-stage-resolve.test.ts` regression: two branch-local plan artifacts in one map, controlled populate order, implement resolution on branch B must bind branch B's plan artifact — not branch A's.
- Pin `// @mutate` on branch-scoped lookup in `findPrecedingWorkflowArtifact`.

## Acceptance criteria

- [ ] `pipeline-stage-resolve.test.ts` — resolving implement on branch B after branch A's plan artifact is populated first still binds branch B's plan artifact; collapsing lookup to `stageId` only makes the test fail.
- [ ] `pipeline-execution.test.ts` — `"branch plan artifacts coexist and resolve independently per branchKey"` stays green after the keying migration.
- [ ] `bun run typecheck` exits zero.

## Documentation updates

- None — operator-facing artifact scoping lands in subspec 01 `daemon-host.md` / `v1-behaviors.md` updates.
