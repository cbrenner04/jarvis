# Branch-key fan-out plan result binding

## Primary implementation surface

Pipeline execution loop in `v2/src/daemon/pipeline-execution.ts` and its plan-recovery consumer in `v2/src/daemon/pipeline-stage-recovery.ts`.

## Problem

`advanceFanOutBranches` pairs each admitted lane with `opts.results[branchIndex]` (`pipeline-execution.ts:2055-2058`). `resolveBlockedPlanStageRecoveryTarget` pairs the named lane with `resolution.results[branchIndex]` (`pipeline-stage-recovery.ts:170-177`). Both join through admitted or split `branchKeys` index into `{ results }` even though resolver output stays paired with intent `downstreamInputs[i]` → `results[i]`. When those orderings diverge, or `{ results }` is short or missing a branch-key match, a lane can bind a sibling's steps or skip without refusal.

Reachable on main: `advanceFanOutBranches` indexes `opts.results[branchIndex]` at `pipeline-execution.ts:2058`; recovery selects `resolution.results[branchIndex]?.steps` at `pipeline-stage-recovery.ts:177`; `runFanOutBranchAction` silently skips `undefined` steps at `pipeline-execution.ts:2125` under concurrent fan-out.

## Decision ledger

- Export a shared fan-out plan result binder from `pipeline-execution.ts`; `pipeline-stage-recovery.ts` imports it; rules out duplicating binding logic or keeping `results[branchIndex]` joins.
- Binder builds `branchKey → result` from parallel `downstreamInputs[i]` / `results[i]` via `branchKeyFromDownstreamInput`, then looks up by lane key; rules out `branchKeys.indexOf` / `split.branchKeys` index into `{ results }`.
- When no map entry matches the lane key, or `results.length < downstreamInputs.length`, refuse naming the affected lane and downstream input; rules out dispatching a sibling's steps or silently skipping the lane.
- `advanceFanOutBranches` validates every actionable lane's binding before any `runFanOutBranchAction` dispatch under `runConcurrently`; rules out partial sibling dispatch when one lane refuses.
- Named non-`default` lanes with single-path `{ steps }` resolution use `singleStageResolutionSteps(resolution)` in recovery; rules out `undefined` refusal after branch-scoped plan resolution when fan-out `{ results }` are absent.
- Recovery keeps the existing `branchKey: "default"` fan-out refusal path; rules out changing recovery admission guards.
- Reorder and mismatch regressions use distinguishable per-branch step markers in stubbed `{ results }`; rules out assertions that only observe dispatch row `branchKey` without step identity.

## Tasks

- Add `fanOutPlanResultForBranch(downstreamInputs, results, branchKey)` (or equivalent) in `pipeline-execution.ts`: parallel-index map, branch-key lookup, structured refusal with lane and downstream input named.
- In `advanceFanOutBranches`, replace `opts.results[branchIndex]` with the binder; gather and refuse all binding failures before the first `runFanOutBranchAction`.
- In `pipeline-stage-recovery.ts`, replace fan-out `resolution.results[branchIndex]?.steps` with the shared binder over intent `downstreamInputs`; wire `singleStageResolutionSteps(resolution)` for named non-`default` lanes when `!isFanOutStageResolution(resolution)`.
- Add `pipeline-execution.test.ts` regression `fan-out plan dispatch binds results by derived branch key when branchKeys order diverges from downstreamInputs`: approve every fan-out gate back to back on the default-row path so `isFanOutStageResolution` → `advanceFanOutBranches` consumes `{ results }`; keep `results[i]` paired with `downstreamInputs[i]` and permute admitted `branchKeys` relative to that order (direct binder call and/or in-body `// @mutate` on the `branchKeys` passed to `advanceFanOutBranches`); assert each lane dispatches the distinguishable step for its branch key, not `results[branchIndex]`; fails against pre-fix `opts.results[branchIndex]` binding at `pipeline-execution.ts:2058`.
- Add `pipeline-execution.test.ts` regression `fan-out plan dispatch refuses when results are shorter than downstreamInputs`: supply `{ results }` shorter than intent `downstreamInputs`; assert refusal names the affected lane and downstream input and no sibling plan row dispatches; fails against pre-fix silent skip at `pipeline-execution.ts:2125`.
- Add `pipeline-execution.test.ts` regression `fan-out plan dispatch refuses a branch-key mismatch without sibling dispatch`: supply a full-length `{ results }` set whose parallel-index keys do not include an admitted lane's derived key; assert refusal names that lane and downstream input and no sibling plan row dispatches; fails against pre-fix sibling mis-bind at `pipeline-execution.ts:2058`.
- Update `pipeline-stage-recovery.test.ts` so `selects the named non-first fan-out result for plan recovery` retargets its `// @mutate` checkpoint to the branch-key binder selection expression and fails against pre-fix `resolution.results[branchIndex]?.steps` binding.
- Update `pipeline-stage-recovery.test.ts` so `refuses fan-out recovery when the named branch has no paired result` exercises missing branch-key match (not merely absent index) and retargets its guard-inversion checkpoint to the binder refusal path.

## Acceptance criteria

- [ ] `pipeline-execution.test.ts` test `fan-out plan dispatch binds results by derived branch key when branchKeys order diverges from downstreamInputs` approves every fan-out gate back to back on the default-row path, keeps `results[i]` paired with `downstreamInputs[i]`, permutes admitted `branchKeys` relative to that order, and proves each lane dispatches the branch-key-matched step rather than `results[branchIndex]`; fails against pre-fix `opts.results[branchIndex]` binding at `pipeline-execution.ts:2058`.
- [ ] `pipeline-execution.test.ts` test `fan-out plan dispatch refuses when results are shorter than downstreamInputs` supplies a short `{ results }` set and proves dispatch refuses with the affected lane and downstream input named while no sibling plan row dispatches; fails against pre-fix silent skip at `pipeline-execution.ts:2125`.
- [ ] `pipeline-execution.test.ts` test `fan-out plan dispatch refuses a branch-key mismatch without sibling dispatch` supplies a full-length mismatched `{ results }` set and proves dispatch refuses with the affected lane and downstream input named while no sibling plan row dispatches; fails against pre-fix sibling mis-bind at `pipeline-execution.ts:2058`.
- [ ] `pipeline-stage-recovery.test.ts` test `selects the named non-first fan-out result for plan recovery` proves a non-first lane selects its branch-key-matched result, carries an in-body `// @mutate` directive against the branch-key binder selection expression, and fails against pre-fix `resolution.results[branchIndex]?.steps` binding.
- [ ] `pipeline-stage-recovery.test.ts` test `refuses fan-out recovery when the named branch has no paired result` refuses a missing branch-key match without positional fallback and carries an in-body `// @mutate` directive against the binder refusal guard.
- [ ] `pipeline-execution.test.ts` — `approving both fan-out branches dispatches each successor on its own branchKey` stays green.
- [ ] `pipeline-execution.test.ts` — `approve-intent continuation dispatches only the approved branchKey` stays green.
- [ ] `pipeline-execution.test.ts` — `after fan-out admission, default rows do not dispatch plan or implement while per-branch rows exist` stays green.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- Deferred to `01`–`03`.
