# Daemon production code drops invert-for-test hooks

Daemon modules export `setInvert*ForTest` hooks and thread `invert*` parameters and
`invert*ForTest` type members (e.g. `invertRegistryReleaseBeforeKill` in `daemon.ts`) so
guard-inversion ACs pass without mutating real guards (`pipeline-stage-resolve`,
`pipeline-execution`, `daemon.ts`).

**Scope:** production hook removal in `v2/src/daemon/**/*.ts` outside `*.test.ts`; rewrite
daemon-owned guard-inversion tests to comment-checkpoint source mutations. Minimal
`workflow.test.ts` surgery deletes dedicated invert `test()` blocks and imports of removed
daemon exports only — CLI spec restores comment-checkpoint coverage on daemon guards there.

## Decisions

- Strip all four forbidden hook shapes from `daemon.ts`, `pipeline-stage-resolve.ts`, and `pipeline-execution.ts` — rules out retaining hooks, `invertRegistryReleaseBeforeKill` parameter plumbing, or renaming to evade a future guard.
- `settleKilledWorkflowOwnership` always commits guarded kills before registry release — rules out keeping an `invertRegistryReleaseBeforeKill` test parameter after hook removal.
- Comment-checkpoint guard-inversion per `v2/docs/test-writing.md` and exemplar `daemon-workflow-start.test.ts` — rules out dedicated invert `test()` bodies that call deleted setters.
- Delete dedicated invert `test()` blocks that import removed daemon exports; add comment checkpoints on positive pinning tests naming the production guard mutation — rules out tautological setter calls.
- `workflow.test.ts`: delete `inverting guarded kill before repair quiescence…` and `inverting registry release before guarded kill…` plus `setInvertWorkflowKillBeforeRepairQuiescenceForTest` import — rules out editing CLI production modules; `cli-drop-production-invert-hooks` restores comment checkpoints on positive pinning tests there.
- `pipeline-end-to-end.sandbox-unrunnable.test.ts` inversions use source mutation, not imported setters — rules out sandbox-only exceptions.
- Documentation updates: none — `write-step-rules-forbid-production-invert-hooks` owns operator-facing guard-inversion doc.

## Tasks

- **daemon.ts:** remove `invertAdmissionContextHandoffForTest` (+ setter), `invertWorkflowKillBeforeRepairQuiescenceForTest` (+ setter), `invertWorkflowRegistryReleaseBeforeKillForTest` (+ setter), and `invertRegistryReleaseBeforeKill` from `settleKilledWorkflowOwnership`; inline real guards at call sites.
- **pipeline-stage-resolve.ts:** remove `invertPriorWorktreeRootGuardForTest` (+ setter); `selectChainedStageCwd` returns `priorWorktreePath` unconditionally.
- **pipeline-execution.ts:** remove `invertResumeFailedRequiresReopenForTest` (+ setter) and `invertPipelineTerminalPublicationFailureGuardForTest` (+ setter).
- **daemon-pipeline-start.test.ts:** delete `inverting admission-context handoff fails persistence regression`; add comment checkpoint on `pipeline_start persists supplied context before returning pipelineId` naming mutation `createPipeline({ definition, context })` → `createPipeline({ definition })` in `handlePipelineStartHandler`.
- **pipeline-stage-resolve.test.ts:** remove `setInvertPriorWorktreeRootGuardForTest` import, `afterEach` reset, and mid-test setter toggles; add comment checkpoints on chained-resolution pinning tests naming mutation on `selectChainedStageCwd` (`return priorWorktreePath` → `return contextCwd`).
- **pipeline-execution.test.ts:** remove `setInvertPipelineTerminalPublicationFailureGuardForTest` import and inline setter toggles in `fails a pipeline when its terminal action fails`; add comment checkpoint naming mutation on `hasPipelineTerminalPublicationFailure` (delete the `terminalPublicationFailure !== null` check or force `return false`).
- **pipeline-end-to-end.sandbox-unrunnable.test.ts:** delete `inverting resumeFailedRequiresReopen refuses resume after plan failure` and `inverting prior-worktree guard fails chained resolution`; remove setter imports and `afterEach` resets; add comment checkpoints on `admits through handlers, fails first plan via faked wait, resumes, approves gates, and settles ready` (mutation: `resumeFailedRequiresReopen` returns `derivedState !== "failed"`) and `walks intent → plan → implement with chained artifacts only on stage worktrees` (mutation: `selectChainedStageCwd` returns `contextCwd`).
- **workflow.test.ts (compile-only):** delete the two dedicated daemon-guard invert `test()` blocks and `setInvertWorkflowKillBeforeRepairQuiescenceForTest` import; leave `settleKilledWorkflowOwnership` positive-order assertion if still valid without `invertRegistryReleaseBeforeKill`.
- Run `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2`.

## Acceptance criteria

- [x] `v2/src/daemon/**/*.ts` outside `*.test.ts` carry no `setInvert*ForTest` export, `invert*ForTest` module variable, `invert*` function parameter, or `invert*ForTest` type member.
- [ ] (Manual) In `daemon-pipeline-start.test.ts`, the documented admission-context mutation turns `pipeline_start persists supplied context before returning pipelineId` RED.
- [ ] (Manual) In `pipeline-stage-resolve.test.ts`, the documented `selectChainedStageCwd` mutation turns its chained-resolution pinning tests RED.
- [ ] (Manual) In `pipeline-end-to-end.sandbox-unrunnable.test.ts`, the documented `resumeFailedRequiresReopen` mutation turns its resume-and-settle test RED.
- [ ] (Manual) In `pipeline-execution.test.ts`, the documented `hasPipelineTerminalPublicationFailure` mutation turns `fails a pipeline when its terminal action fails` RED.
- [x] `daemon-pipeline-start.test.ts` — `pipeline_start persists supplied context before returning pipelineId` stays green.
- [x] `pipeline-end-to-end.sandbox-unrunnable.test.ts` — `walks intent → plan → implement with chained artifacts only on stage worktrees` stays green.
- [x] `pipeline-execution.test.ts` — `fails a pipeline when its terminal action fails` stays green.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- None — `write-step-rules-forbid-production-invert-hooks` owns operator-facing guard-inversion doc.

## Blocker

Artifact contract check failed: Unticked non-human-only acceptance criteria:
- (Manual) In `daemon-pipeline-start.test.ts`, the documented admission-context mutation turns `pipeline_start persists supplied context before returning pipelineId` RED.
- (Manual) In `pipeline-stage-resolve.test.ts`, the documented `selectChainedStageCwd` mutation turns its chained-resolution pinning tests RED.
- (Manual) In `pipeline-end-to-end.sandbox-unrunnable.test.ts`, the documented `resumeFailedRequiresReopen` mutation turns its resume-and-settle test RED.
- (Manual) In `pipeline-execution.test.ts`, the documented `hasPipelineTerminalPublicationFailure` mutation turns `fails a pipeline when its terminal action fails` RED.
