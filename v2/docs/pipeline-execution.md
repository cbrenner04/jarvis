# Pipeline execution

Canonical cross-file contract for pipeline definition, admission, stage lifecycle, dispatch, settlement, fan-out, approval gates, derived state, terminal publication, daemon restart continuation, and operator recovery. Component scope stays in sibling docs: [`workflow-runner.md`](./workflow-runner.md) (preset/builder and workflow-step semantics), [`daemon-host.md`](./daemon-host.md) (RPC transport, malformed params, daemon startup order), [`state-store.md`](./state-store.md) (SQL shapes and store operations), [`operator-runbook.md`](./operator-runbook.md) (CLI recipes — linked, not duplicated here).

## Definitions and registry

A pipeline definition (`PipelineDefinition` in `pipeline-definition.ts`) is a `name`, optional `terminalAction` (`leave-draft` | `ready` | `merge` from `PIPELINE_TERMINAL_ACTIONS`), and ordered `stages`:

- **Workflow stage** — `{ stageId, kind: "workflow", workflow, review }` where `workflow` ∈ `BASE_WORKFLOW_NAMES` (`intent`, `plan`, `implement`) and `review` ∈ `none` | `light` | `debate`.
- **Approval stage** — `{ stageId, kind: "approval" }`.

`validatePipelineDefinition` (`pipeline-definition.ts`) is the sole admission authority on realizable `(workflow, review)` pairs; it returns `{ ok: true }` or `{ ok: false, errors }` with codes `unknown-workflow`, `invalid-review-posture`, `unrealizable-review-posture`, `missing-role-binding`, `duplicate-stage-id`, `empty-pipeline`. Tests: `pipeline-definition-validation.test.ts`.

`getPipelineDefinition` (`pipeline-registry.ts`) is a total lookup: `{ ok: true, definition }` or `{ ok: false, error: { code: "unknown-pipeline" } }`. Shipped definitions: `full-review`, `fast`. Tests: `pipeline-registry.test.ts`.

`resolveProjectPipeline` (`project-pipeline-resolution.ts`) merges registry rows with per-project `terminalAction` and `reviewOverrides`; refuses `invalid-project-pipeline-config`, `unknown-pipeline`, `invalid-pipeline-definition`, and terminal-action without an implement stage. Tests: `project-pipeline-resolution.test.ts`.

Posture → preset mapping for dispatch lives in `pipeline-stage-resolve.ts` (merge-day duplicate of CLI preparation — see [Pending dispatch boundary](#pending-dispatch-boundary)).

## Admission and `PipelineContext`

CLI admission (`admitPipelineStart` in `pipeline-start-admission.ts`) validates seed input, resolves project pipeline config, builds an immutable `PipelineContext`, and RPCs `pipeline_start`. Pre-admission refusals: `invalid-seed-input`, `unregistered-project`, `configuration-read-exception`, `missing-pipeline`, `missing-machine-model-configuration`, `invalid-machine-model-configuration`, `invalid-seed-path`, `invalid-project-pipeline`. Post-contact refusals: `daemon-refusal`, `malformed-daemon-response`, `rpc-transport-failure`, `connection-lifecycle-failure`. Tests: `pipeline-start-admission.test.ts`.

Daemon `pipeline_start` (`handlePipelineStart` in `daemon.ts`) persists the supplied context in the same transaction as definition and stage rows via `StateStore.createPipeline`, then detaches `runPipeline`. It does not re-run `validatePipelineDefinition`. Missing `definition`/`context` → `invalid_params`; context not durably persisted → `admission_failed`.

### `PipelineContext` immutability

`PipelineContext` (`state-store.ts`) is `{ cwd, configPath?, targetDir?, projectRegistry?, seed?, seedPath? }`, stored as JSON on the pipeline row. **Immutability** means the admission snapshot is preserved as written, not that it is complete or valid. The store does not enforce mutual exclusivity of `seed` and `seedPath`; dual-populated rows load as stored. At admission, `admitPipelineStart` sets at most one of file `seedPath` or inline `seed` (from CLI `seedText`).

Resolution (`resolveIntentStage` in `pipeline-stage-resolve.ts`): `seedPath` → file `seed`; `seed` → `seedText`; `seedPath` wins when both are present on a loaded row. First workflow stage uses admitted context; later stages load the prior stage entry run (`store.loadRun(artifact.entryRunId)`) and use its `worktreePath` as preset `cwd`. Artifact `specPath` stays worktree-relative.

**Missing context:** `pipeline.context === null` (pre-migration or omitted admission) refuses continuation (`persistedContextLoadPermitsContinuation` → `missing_context` in `continuePipeline` / `resumePipeline`) and recovery resolution (`resolveBlockedPlanStageRecoveryTarget`). Restart continuation and operator resume load context only from the durable row — never caller reconstruction.

## Merge-day dispatch

Current production path (pending replacement — see [Pending dispatch boundary](#pending-dispatch-boundary)):

1. `resolveStageWorkflowSteps` (`pipeline-stage-resolve.ts`) — local posture table, `FIXED_REVIEW_PASSES = 1`, direct `WORKFLOW_PRESET_BUILDERS`, chained `cwd` via `createChainedStageProjectMatch`.
2. `stampPipelineDispatchSteps` (`pipeline-execution.ts`) — machine config from `context.configPath` (throws when absent).
3. Intent-only stale reset via injected `intentStaleReset` (`advanceWorkflowStage` in `pipeline-execution.ts`).
4. `dispatchPipelineStage` (`pipeline-stage-dispatch.ts`) — `claimPipelineStageAdmission`, `defaultPipelineDispatch` → `handleWorkflowStart` → `startWorkflowRun`, `defaultPipelineWait` rollup.

Stage row: `pending` → claim → `running` + `workflowInvocationId` (entry run id). Worktree claim refusal at dispatch records stage `failed`. Tests: `pipeline-stage-dispatch.test.ts`, `pipeline-stage-resolve.test.ts`, `pipeline-execution.test.ts` (`runPipeline`, fan-out, intent stale-reset refusal).

## Merge-day settlement

Current production path (pending replacement — see [Pending settlement boundary](#pending-settlement-boundary)):

1. After dispatch, `pipelineWait` rolls up the entry run (`waitForWorkflowEntryRun`).
2. `applyEntryRunSettlement` copies `specPath`, `prNumber`, `prUrl`, `downstreamInputs` from the durable entry run into stage `artifact`; terminal status `succeeded` or `failed`.
3. If the entry run is still live when settlement would run, `failureDetail: { code: "settlement_deferred", reason: "entry_run_still_live" }` is recorded (`dispatchPipelineStage` catch path).
4. On restart/resume, `adoptAndSettlePipelineStage` / `settlementLinkedEntryRunId` redrives settlement without re-dispatching workflow steps.
5. `redrivableDeferredSettlementEntryRunId` and `unsettledTerminalStageEntryRunId` (`pipeline-stage-dispatch.ts`) drive `resumeDrivesDeferredSettlement` and `recoverContinuablePipelines`.

**PR-evidence wedge:** when deferred re-settlement completes but the entry run lacks `prNumber`/`prUrl`, settlement fails with `completion_publication_missing_pr_evidence` and terminal publication is not invoked. Tests: `pipeline-stage-dispatch.test.ts` (deferred marker, unsettled terminal), `pipeline-execution.test.ts` (`resumeDrivesDeferredSettlement`, `hasRedrivableDeferredSettlement`, terminal publication settlement).

Entry-run linkage is stored in `pipeline_stages.workflowInvocationId` (column name; value is the entry run id).

## Fan-out lanes

When a splitting intent stage artifact carries `downstreamInputs` with length ≥ 2 (`findFanOutSplit` in `pipeline-execution.ts`):

- One `pipeline_stages` row per `(stageId, branchKey)`; `branchKey` = ready-intent basename without `.md` (`branchKeyFromDownstreamInput`).
- Pre-admitted `default` suffix rows reconcile to `skipped`.
- First chained workflow stage resolves fan-out (`isFanOutStageResolution`); later stages resolve per-branch from branch-local artifacts.
- Sibling branches dispatch concurrently; per-invocation `dispatchClaims` ensures one peer admits the shared fan-out stage (`pipeline-execution.test.ts` — concurrent dispatch).
- Branch failure → `skipRemainingStages` for that `branchKey` only.
- `derivePipelineState` aggregates settlement-first across branches (`deriveFanOutPipelineState`).

**Terminal publication fail-closed:** `resolveTerminalPublicationInput` refuses fan-out pipelines with `multi-branch terminal publication is not defined for fan-out pipelines`; `commitTerminalPublicationFailure` leaves stage rows `succeeded` while derived state is `failed` (`pipeline-execution.test.ts` — `pipeline terminal publication settlement`).

## Approval gates

Approval boundary: `pending` → `awaiting` via `commitApprovalBoundary` (`approvalBoundaryAllowsStatus` in `state-store.ts`). Decision: `awaiting` → `approved` | `rejected` via `commitApprovalDecision` (`approvalDecisionAllowsStatus`). Refusals: `ApprovalRefusalReason` (`stage_not_found`, `not_approval_stage`, `status_not_pending`, `status_not_awaiting`, `invalid_decision`). Fan-out: `branch_key_required` when multiple branch rows exist and `branchKey` omitted (`commitPipelineApprovalDecision`).

`approved` permits suffix dispatch scoped to `branchKey` when supplied (`applyPipelineApprovalDecision` → `continuePipeline`). `rejected` settles the branch/pipeline without later dispatch. Tests: `pipeline-execution.test.ts` — `pipeline approval decisions`, `approval execution guards`.

## Derived state

`derivePipelineState` (`pipeline-execution.ts`) returns `PipelineDerivedState`:

| Derived state | Meaning |
| --- | --- |
| `interrupted` | Any stage row `interrupted` |
| `rejected` | Any approval row `rejected` (prefix scan; fan-out uses branch aggregation) |
| `failed` | Any workflow row `failed`, or `terminalPublicationFailure` set |
| `running` | Any workflow row `running`, or terminal publication pending (`isPipelineSettlementPending`) |
| `awaiting-approval` | Next unsatisfied stage is approval `awaiting` |
| `pending` | Actionable successor not yet satisfied |
| `succeeded` | All authored stages satisfied and terminal publication succeeded (or no `terminalAction`) |

`isPipelineTerminal` — `succeeded` | `failed` | `rejected` | `interrupted`. Tests: `pipeline-execution.test.ts` — `derivePipelineState`, fan-out suffix cases.

## Terminal publication

After every workflow and required approval stage succeeds, `settlePipelineTerminalPublication` (`pipeline-execution.ts`) runs when `isPipelineSettlementPending` is true. Sole executor: `executeTerminalPublication` (`terminal-publication.ts`).

| `terminalAction` | Ready gate | Ready flip | Merge | Missing `prNumber`/`prUrl` |
| --- | --- | --- | --- | --- |
| absent | — | — | — | No publication (`isPipelineSettlementPending` false) |
| `leave-draft` | no | no | no | succeeds (optional passthrough evidence) |
| `ready` | yes | yes | no | fail fast (`missingPrEvidenceFailure`) |
| `merge` | yes | yes | yes | fail fast |

Failures throw `TerminalPublicationError` with normalized `PublicationFailure`; PR evidence is retained (`maybeDestroyPrEvidence` is intentionally no-op). Durable success: `terminalPublicationSucceededAt`; failure: `terminalPublicationFailure` (`PipelineTerminalPublicationFailure`). Pipeline success requires terminal success when `terminalAction` is set.

Completion publication (per-stage push/draft/ready during implement) and terminal publication are separate boundaries — `skipReadyFinalization` on implement when `terminalAction` is `leave-draft`. Tests: `terminal-publication.test.ts`, `state-store.test.ts` — `terminal publication commits`, `pipeline-execution.test.ts` — `pipeline terminal publication settlement`.

## Daemon restart continuation

Startup order (`daemon-host.md`): IPC listener → `recoverContinuablePipelines` → `reconcilePipelines` → reconciled run resume.

`recoverContinuablePipelines` (`pipeline-execution.ts`) calls `continuePipeline` for pipelines whose owner is dead and that pass `isPipelineContinuable` or carry `hasRedrivableDeferredSettlement` (excluding entry runs reconciled this boot). `continuePipeline` loads `pipeline.context`, `claimPipelineContinuation`, then `runPipeline`.

`isPipelineContinuable` — true when `isPipelineSettlementPending`, or derived `pending` with no blocking approval rows and no unreopened `failed` rows (`approvalOutcomePermitsActivation`, `reopenedFailurePermitsActivation`). Does not activate `awaiting-approval` or `rejected` without an explicit decision.

Pinning tests: `pipeline-execution.test.ts` — `pipeline activation after restart`, `continuation execution guards`; `pipeline-stage-dispatch.test.ts` — `redrivableDeferredSettlementEntryRunId`, `unsettledTerminalStageEntryRunId`.

Downstream workflow execution after continuation is ordinary `runPipeline` — not enumerated here.

## Lifecycle reference

### Stage status vocabulary

**Workflow stages** (`pipeline_stages.status`): `pending` → `running` → `succeeded` | `failed` | `interrupted` | `skipped`.

**Approval stages:** `pending` → `awaiting` → `approved` | `rejected`.

Terminal stage-run statuses (stamp `endedAt` via `stageLifecyclePatchWithTerminalFinish`): `succeeded`, `failed`, `interrupted`, `skipped`. Approval `approved`/`rejected` are decisions, not terminal stage-run statuses.

**Pipeline row** (`pipelines.status`): `active` | `interrupted` (orphan reconciliation).

### Allowed transitions and owners

| From | To | Owner |
| --- | --- | --- |
| `pending` (workflow) | `running` | `dispatchPipelineStage` — claim + dispatch |
| `running` (workflow) | `succeeded` / `failed` | `applyEntryRunSettlement` / `adoptAndSettlePipelineStage` |
| `running` (workflow) | `running` + deferred marker | `dispatchPipelineStage` catch while entry run live |
| `failed` (workflow) | `pending` (reopened) | `reopenFailedPipeline` (`state-store.ts`) |
| suffix after failure | `skipped` | `skipRemainingStages` (`pipeline-execution.ts`) |
| `pending` (approval) | `awaiting` | `commitApprovalBoundary` |
| `awaiting` | `approved` / `rejected` | `commitApprovalDecision` |
| all stages satisfied + `terminalAction` | publication success/failure | `settlePipelineTerminalPublication` |
| orphan active pipeline | `interrupted` | `reconcilePipelines` |

### Field ownership

| Field | Owner |
| --- | --- |
| `startedAt`, `endedAt` | Stage lifecycle patches (`updateStage`, `stageLifecyclePatchWithTerminalFinish`) |
| `workflowInvocationId` | Set at dispatch (`dispatchPipelineStage`); entry run id |
| `artifact` | Settlement (`stageArtifactFromEntryRun`, `applyEntryRunSettlement`) |
| `failureDetail` | Dispatch/settlement failures (`derivePipelineFailureDetail`, deferred marker) |
| `decidedAt` | Approval decision commit |
| `terminalPublicationSucceededAt`, `terminalPublicationFailure` | `commitTerminalPublicationSuccess` / `commitTerminalPublicationFailure` |

Symbols: `approvalBoundaryAllowsStatus`, `approvalDecisionAllowsStatus`, `reopenPredecessorAllowsStatus`, `reopenSuffixAllowsStatus`, `analyzeFailedPipelineReopenShape` (`state-store.ts`). Tests: `state-store.test.ts` — `pipelines`, `failed pipeline reopen`.

## Operator recovery

Malformed RPC params and transport errors: [`daemon-host.md`](./daemon-host.md). Fan-out publication refusal: [Terminal publication](#terminal-publication) above. This section covers only direct durable mutations, refusals, and no-effect outcomes from `pipeline resume` and `pipeline recover`.

### `pipeline resume` (`resumePipeline`)

**Unscoped** (`branchKey` omitted or `"default"`):

| Outcome | Condition | Durable effect |
| --- | --- | --- |
| **Admitted** `resumed` | Derived `failed` → `reopenFailedPipeline` then `continuePipeline`; derived `awaiting-approval` → `claimPipelineContinuation` only; derived `pending` after reopen → `continuePipeline`; derived `running` with `resumeDrivesDeferredSettlement` | Reopen mutates failed suffix; claim updates owner; continuation dispatches |
| **Refused** | `pipeline_not_found`; `missing_context`; `claim_refused`; `pipeline_terminal_succeeded`; `pipeline_terminal_rejected`; `pipeline_not_resumable` (derived `running`/`interrupted`/`pending` without reopen, live entry run) | No dispatch |
| **No-effect claim** | `awaiting-approval` with successful claim | Owner updated; no `continuePipeline` until approve |

**Branch-scoped** (`branchKey` set, not `"default"`): bypasses aggregate `derivePipelineState`; uses `resolveBranchResumeAdmission` then `reopenFailedPipeline({ branchKey })` then `continuePipeline(branchKey)`.

| Outcome | Reason |
| --- | --- |
| **Admitted** | Branch suffix has replayable `failed` row, no blocking gate |
| **Refused** | `branch_not_found`; `branch_awaiting_approval`; `branch_rejected`; `branch_not_resumable`; reopen refusal from store |

Tests: `pipeline-execution.test.ts` — `resumePipeline`, `resumePipeline branch scope`; `commands/pipeline.test.ts`.

Helper predicates (pinning): `resumeTerminalRefusalReason`, `resumeAwaitingClaimsOnly`, `resumeFailedRequiresReopen`, `resumeDeferredRefusalApplies`, `resumeReopenedPendingContinuation`, `resumeDrivesDeferredSettlement`.

### `pipeline recover` (`admitAndRecoverPipelineBranchStage`)

Opt-in; never fired by restart continuation. Branch key mandatory.

| Outcome | Condition |
| --- | --- |
| **Admitted** `admitted` | `resolveBlockedPlanStageRecoveryTarget` ok; worktree claim free; `claimPipelineStageAdmission` won |
| **Refused** `resolution_refused` | `pipeline_not_found`, `branch_not_found`, `missing_context`, `no_failed_stage`, `stage_not_plan`, `stage_not_linked`, `stage_resolution_failed`, `stage_not_recoverable` |
| **Refused** `stage_claimed` | Another holder owns stage admission |
| **Attempt refused** | `recoverPlanStage` — `operator_blocker`, `plan_stage_invalid`, `recovery_requires_git`, etc. (stage stays `failed`) |
| **Succeeded** | Review landing + `reopenFailedPipeline` + stage `succeeded` + `continuePipeline(branchKey)` |

Distinct from `pipeline resume`: recover never invokes plan drafting; `pipeline resume` redispatches the ordinary write step. Tests: `pipeline-stage-recovery.test.ts`; `daemon-pipeline-recover.test.ts`.

### Wedged `running` stage

Two shapes settle via `resumeDrivesDeferredSettlement` or restart `recoverContinuablePipelines`:

1. Deferred marker — `redrivableDeferredSettlementEntryRunId`.
2. No marker — `unsettledTerminalStageEntryRunId` when entry run rollup is terminally `failed`.

Live entry run → `pipeline_not_resumable`. No-marker wedge on live daemon may need two unscoped resumes (settle, then reopen). See [`operator-runbook.md` § Wedged pipeline-stage settlement](./operator-runbook.md#wedged-pipeline-stage-settlement-after-daemon-death).

## Pending boundaries

Merge-day behavior above is not settled architecture. Pending restructures:

| Target | Tracking artifact | Status |
| --- | --- | --- |
| Shared CLI/daemon dispatch front door | [`pipeline-dispatch-shares-cli-front-door`](../spec/seeds/pipeline-dispatch-shares-cli-front-door.md) | Pending — ready-intent chain not landed |
| Run-row-derived settlement | [`pipeline-settlement-derives-from-run-rows`](../spec/seeds/pipeline-settlement-derives-from-run-rows.md) | Pending — ready-intent chain not landed |

Land the documentation spec before either restructure, or replan this page against whichever merged behavior lands first.

## Related docs

- [`workflow-runner.md`](./workflow-runner.md) — preset builders, workflow steps, per-stage completion publication (component scope).
- [`daemon-host.md`](./daemon-host.md) — RPC methods, startup sweep, malformed transport (component scope).
- [`v2-architecture.md`](./v2-architecture.md) — layered model summary.
- [`operator-runbook.md`](./operator-runbook.md) — CLI recipes for start, approve, resume, recover.
