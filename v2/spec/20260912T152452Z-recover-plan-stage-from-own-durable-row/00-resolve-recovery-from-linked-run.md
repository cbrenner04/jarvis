# Resolve plan recovery from the linked run

## Problem

`resolveBlockedPlanStageRecoveryTarget` calls the dispatch-oriented stage resolver. A failed plan row with a valid staged tree therefore refuses `stage_resolution_failed` when its preceding workflow artifact is absent, although recovery neither reads that input nor redispatches the plan workflow.

## Behavior

Explicit recovery derives the target from the failed plan row's `workflowInvocationId`, linked persisted run, and that run's workflow snapshot, then submits the recorded worktree and reconstructed plan landing to recovery. It does not load pipeline context or dispatch resolution. Missing predecessor artifacts remain fatal only to ordinary plan-stage dispatch.

## Decisions

- Resolve recovery identity, worktree, destination, write identity, and plan landing from the failed row, linked run, and its persisted snapshot, not `resolveStageWorkflowSteps` or preceding artifacts; the ruled-out dispatch path rejects recoverable staged bytes.
- Replace `PlanStageRecoveryRequest.steps` with a narrow descriptor: review snapshot `stepId`/`behavior`, recorded worktree and `specPath`, fixed plan-stage/verdict paths, and write snapshot `landingInputs`, not a fabricated `AnyWorkflowStep`; snapshots do not retain complete review-role configuration.
- Carry the linked write snapshot's `landingInputs` into that descriptor, not freshly resolved ready-intent inputs; recovery must consume the admitted ready-intent.
- Require no pipeline context for explicit recovery, not `missing_context` or malformed-context refusal; recovery neither resolves nor dispatches a workflow.
- Use the linked run's recorded worktree for both staged-tree validation and landing, not a re-resolved review `cwd`; a `cwd`-mismatch refusal has no durable recovery input.
- Refuse missing or malformed linked snapshots, write/review identities, recorded paths, or required `landingInputs` as `stage_not_recoverable` during resolution, not after claim or partial landing.
- Keep `review: "none"` ineligible, not inferred as a landing-capable review from the write step.
- Keep recovery eligibility, stage-claim ordering, and missing-stage refusal behavior, not looser admission after removing dispatch resolution.
- Leave `pipeline resume` and general stage resolution unchanged, not a shared relaxation; plan dispatch still requires the preceding artifact and retains its `pipeline-stage-resolve:` diagnostic.

## Task checklist

- [ ] Replace dispatch-oriented recovery target resolution with failed-row/link-run snapshot reconstruction and a narrow recovery landing request.
- [ ] Preserve linked write `landingInputs` through daemon resolution and direct recovery landing.
- [ ] Replace context, resolver-error, paired-result, and `cwd`-mismatch recovery assertions with durable-row admission and named durable-snapshot refusal coverage.
- [ ] Preserve invalid-target, claim-held, missing-stage, `review: "none"`, and direct-landing coverage.
- [ ] Document the recovery-versus-dispatch resolution boundary and operator preconditions.

## Acceptance criteria

- [x] `v2/src/daemon/pipeline-stage-recovery.test.ts` gains a regression proving a failed plan stage with a populated staged tree and absent predecessor artifact admits from its linked run without calling the dispatch resolver, and its daemon-resolved landing consumes the linked write snapshot's ready-intent; it fails against the pre-fix `stage_resolution_failed` path.
- [x] `v2/src/daemon/pipeline-stage-recovery.test.ts` proves null and malformed pipeline context admit the same durable target, and no `cwd` mismatch or paired dispatch-result shape is consulted during recovery resolution.
- [x] `v2/src/daemon/pipeline-stage-recovery.test.ts` gives `stage_not_recoverable` before claim for each missing required linked-run snapshot, write/review identity, recorded path, or required `landingInputs` shape.
- [x] `v2/src/daemon/pipeline-stage-resolve.test.ts` — `downstream input never landed anywhere durable refuses with distinct named reason pointing at standalone re-drive` stays green.
- [x] `v2/src/daemon/pipeline-stage-recovery.test.ts` splits `refuses an unrecoverable stage target with a named reason`: non-failed, non-plan, and missing row-to-run linkage stay refused, while its former context, dispatch-resolution, paired-result, and `cwd`-mismatch assertions are replaced by the new durable-resolution coverage.
- [x] `v2/src/daemon/pipeline-stage-recovery.test.ts` keeps `review: "none"` plan recovery refused as `stage_not_recoverable`.
- [x] `v2/src/daemon/pipeline-stage-recovery.test.ts` — `recovery refuses a stage whose admission claim is held` stays green.
- [x] `v2/src/execution/workflow-runner-resume.test.ts` — `refuses review-failed recovery for ineligible write, staging, blocker, live-claim, and review-sibling shapes` stays green for a missing staged tree.
- [x] `v2/src/execution/workflow-runner-resume.test.ts` — `recovers an operator-edited plan stage through publication without redrafting` stays green with the narrow recovery landing request, proving byte-preserving landing without a plan writer, reviewer, or actuator invocation.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- [ ] `v2/docs/pipeline-execution.md` distinguishes failed-row/link-run snapshot recovery from predecessor-artifact-dependent dispatch, removes context/dispatch-only recovery refusals, and names incomplete durable reconstruction refusals.
- [ ] `v2/docs/daemon-host.md` replaces the dispatch-resolver-based recovery target contract with narrow durable landing reconstruction and its required-field refusal boundary.
- [ ] `v2/docs/operator-runbook.md` removes predecessor and pipeline-context resolution from `pipeline recover` preconditions while retaining linked-run, staged-tree, and claim requirements.
- [ ] `v2/docs/v1-behaviors.md` records that explicit plan-stage recovery resolves from its row and linked snapshot without pipeline context while plan dispatch remains predecessor-dependent.
