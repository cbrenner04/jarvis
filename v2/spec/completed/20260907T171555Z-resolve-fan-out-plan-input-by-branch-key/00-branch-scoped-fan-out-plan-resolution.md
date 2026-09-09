# Branch-scoped fan-out plan resolution

## Primary implementation surface

Daemon stage resolution in `v2/src/daemon/pipeline-stage-resolve.ts`.

## Problem

`resolveChainedReadyIntentPaths` verifies every `downstreamInputs` entry before plan dispatch. When a sibling lane already planned, its ready-intent was consumed into that lane's spec tree and no longer resolves at the recorded path, so an approved later lane fails on the sibling's missing file even though its own input is present. `resolvePlanWorkflowStage` never reads `deps.branchKey` for input selection; `neverLandedDownstreamInputError` also misdirects operators to re-drive the intent stage after a successful intent.

Reachable on main: `resolveChainedReadyIntentPaths` loops all `downstreamInputs` at `pipeline-stage-resolve.ts:394-399`; suffix plan dispatch passes a named `branchKey` into `resolveStageWorkflowSteps` via `advanceWorkflowStage` (`pipeline-execution.ts:2397-2404`).

## Decision ledger

- When `deps.branchKey` is not `DEFAULT_PIPELINE_STAGE_BRANCH_KEY`, resolve the fan-out plan lane from the sole downstream input whose locally duplicated `branchKeyFromDownstreamInput(path)` equals `deps.branchKey`, verify only that input, and return single-path `{ steps }` via `resolvePlanStage`; rules out whole-list verification, re-entering `resolveForDownstreamPaths`, or fan-out `{ results }` shape for branch-scoped resolution.
- Duplicate `branchKeyFromDownstreamInput` locally in `pipeline-stage-resolve.ts`; rules out importing from `pipeline-execution.ts` (import cycle via `resolveStageWorkflowSteps`).
- When no downstream input matches the active `branchKey`, refuse with the lane and the available downstream inputs named; rules out positional fallback or silent selection.
- Branch-scoped selection assumes unique derived branch keys among `downstreamInputs` (admission already rejects duplicates via `admitFanOutBranches`); if resolution observes duplicate derived keys, refuse naming the collision; rules out arbitrary pick among colliding inputs.
- A downstream input is consumed when its ready-intent path is absent from admission and the prior branch and a succeeded plan-stage artifact exists for `branchKeyFromDownstreamInput(path)` with directory `specPath`; rules out treating landed sibling consumption as `neverLandedDownstreamInputError`.
- Discriminate consumed vs missing in `verifyChainedReadyIntentPath`, shared by `resolveChainedReadyIntentPaths` and `resolveForDownstreamPaths`; rules out satisfaction wired only in one verification loop.
- Whole-list consumed-input satisfaction serves initial default-row fan-out plan resolution (default `branchKey`, multi `downstreamInputs` → fan-out `{ results }` via `resolveForDownstreamPaths`); rules out deferring satisfaction to suffix `continuePipeline(branchKey)` dispatch, which branch-scopes input selection after this fix.
- When the prior intent stage succeeded, omit "re-drive the prior stage standalone" guidance from downstream-input refusal text; rules out directing the operator to repeat unrelated intent work.
- Refusal message-shape coverage exercises unmatched `branchKey` with a succeeded prior intent artifact present; rules out conflating with matched-but-unresolvable paths.
- Keep branch-scoped selection and whole-list consumed-input satisfaction in `pipeline-stage-resolve.ts`; rules out splitting them across module boundaries.

## Tasks

- Duplicate `branchKeyFromDownstreamInput` locally in `pipeline-stage-resolve.ts` and thread `deps.branchKey` through `resolvePlanWorkflowStage` / `resolveChainedReadyIntentPaths` for branch-scoped input selection.
- When branch-scoped, verify only the matched downstream input and return `{ steps }` through `resolvePlanStage`; do not re-enter `resolveForDownstreamPaths`.
- Extend `verifyChainedReadyIntentPath` (and its call sites) with the inputs needed to apply consumed-input satisfaction using the succeeded plan-stage artifact signal above.
- Adjust downstream-input refusal messages to name the failing lane and available inputs and to suppress intent re-drive guidance when the prior intent artifact is present and succeeded.
- Add `pipeline-stage-resolve.test.ts` regression `branch-scoped plan resolution verifies only the requested fan-out lane when a sibling input is unresolvable`: two downstream inputs, sibling path absent/unresolvable, resolve with production `splitPosition` and the second lane's `branchKey` through `resolveStageWorkflowSteps` deps, assert `{ steps }` (not `{ results }`), only that lane is verified and built; fails against the pre-fix whole-list resolver.
- Add `pipeline-stage-resolve.test.ts` regression `branch-scoped plan resolution binds downstream input by branchKey equality`: pass production `splitPosition` and `branchKey` through deps; assert `readyIntent` matches the input whose derived branch key equals the requested lane; fails against the pre-fix whole-list resolver.
- Add `pipeline-stage-resolve.test.ts` regression `branch-scoped plan resolution refuses unmatched branchKey naming lane and available downstream inputs`: request a `branchKey` with no matching downstream input while the prior intent artifact succeeded; assert refusal names the lane and lists available inputs; fails against the pre-fix resolver.
- Add `pipeline-stage-resolve.test.ts` regression `unscoped fan-out plan resolution treats consumed sibling ready-intent as satisfied`: resolve without branch scoping (default `branchKey`) with one consumed sibling input and one resolvable input; assert fan-out `{ results }` resolution succeeds rather than failing on the consumed path; fails against the pre-fix whole-list verifier.
- Add `pipeline-stage-resolve.test.ts` regression `plan resolution refusal names the failing lane and omits intent re-drive when prior intent succeeded`: unmatched `branchKey` with succeeded prior intent artifact; assert the message names the lane and does not contain standalone intent re-drive guidance; fails against the pre-fix refusal text.

## Acceptance criteria

- [x] `pipeline-stage-resolve.test.ts` test `branch-scoped plan resolution verifies only the requested fan-out lane when a sibling input is unresolvable` asserts `{ steps }` resolution (not `{ results }`), only the requested lane's downstream input is verified and built while a sibling input is unresolvable, and fails against the pre-fix whole-list resolver.
- [x] `pipeline-stage-resolve.test.ts` test `branch-scoped plan resolution binds downstream input by branchKey equality` asserts lane selection uses derived branch-key equality and fails against the pre-fix whole-list resolver.
- [x] `pipeline-stage-resolve.test.ts` test `branch-scoped plan resolution refuses unmatched branchKey naming lane and available downstream inputs` asserts an unmatched lane-to-input request refuses with the lane and available downstream inputs named and fails against the pre-fix resolver.
- [x] `pipeline-stage-resolve.test.ts` test `unscoped fan-out plan resolution treats consumed sibling ready-intent as satisfied` asserts a sibling ready-intent consumed into its landed spec tree is satisfied rather than missing during initial default-row whole-list verification and fails against the pre-fix whole-list verifier.
- [x] `pipeline-stage-resolve.test.ts` test `plan resolution refusal names the failing lane and omits intent re-drive when prior intent succeeded` exercises unmatched `branchKey` with succeeded prior intent artifact, asserts the failed lane is named and successful prior intent work is not answered with standalone intent re-drive guidance, and fails against the pre-fix refusal text.
- [x] `pipeline-stage-resolve.test.ts` — `splitting intent artifact with N=2 downstreamInputs resolves plan into two distinct ready-intent bindings` stays green.
- [x] `pipeline-stage-resolve.test.ts` — `missing downstreamInputs path fails without falling back to directory specPath` stays green.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- Deferred to `01`–`02`.
