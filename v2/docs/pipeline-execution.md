# Pipeline execution

Canonical cross-file contract for pipeline definition, admission, stage lifecycle, dispatch, settlement, fan-out, approval gates, derived state, terminal publication, daemon restart continuation, and operator recovery. Component scope stays in sibling docs: [`workflow-runner.md`](./workflow-runner.md) (preset/builder and workflow-step semantics), [`daemon-host.md`](./daemon-host.md) (RPC transport, malformed params, daemon startup order), [`state-store.md`](./state-store.md) (SQL shapes and store operations), [`operator-runbook.md`](./operator-runbook.md) (CLI recipes — linked, not duplicated here).

## Definitions and registry

A pipeline definition (`PipelineDefinition` in `pipeline-definition.ts`) is a `name`, optional `terminalAction` (`leave-draft` | `ready` | `merge` from `PIPELINE_TERMINAL_ACTIONS`), and ordered `stages`:

- **Workflow stage** — `{ stageId, kind: "workflow", workflow, review }` where `workflow` ∈ `BASE_WORKFLOW_NAMES` (`intent`, `plan`, `implement`) and `review` ∈ `none` | `light` | `debate`.
- **Approval stage** — `{ stageId, kind: "approval" }`.

Workflow/review realizability and posture → preset realization live in `workflow-start-preparation.ts` for all callers (`validatePipelineDefinition`, CLI admission, and `pipeline-stage-resolve`). `prepareWorkflowStart` composes preset builder invocation, machine-config stamping, and connected stale-workspace preflight. CLI `run workflow` adapts argv through `workflow.ts`; daemon pipeline stage resolution adapts stage posture, artifacts, and admission `configPath` through `preparePipelineStageWorkflow` (`pipeline-workflow-preparation.ts`) → `prepareWorkflowStart`, returning stamped steps with no dispatch-time re-stamping. Pipeline stages pass resolved review posture to their builders: `implement` + `none` is unrealizable, and a `fast` implement stage runs one light critic rather than debate. Standalone `jarvis run workflow implement` resolves omitted review inputs from project config or defaults in `resolveImplementReviewConfig` (`implement-workflow-steps.ts`). `validatePipelineDefinition` (`pipeline-definition.ts`) applies the realizability contract at pipeline admission and returns `{ ok: true }` or `{ ok: false, errors }` with codes `unknown-workflow`, `invalid-review-posture`, `unrealizable-review-posture`, `missing-role-binding`, `duplicate-stage-id`, `empty-pipeline`. Tests: `workflow-start-preparation.test.ts`, `pipeline-definition-validation.test.ts`, `workflow.test.ts`.

`getPipelineDefinition` (`pipeline-registry.ts`) is a total lookup: `{ ok: true, definition }` or `{ ok: false, error: { code: "unknown-pipeline" } }`. Shipped definitions: `full-review`, `fast`. Tests: `pipeline-registry.test.ts`.

`resolveProjectPipeline` (`project-pipeline-resolution.ts`) merges registry rows with per-project `terminalAction` and `reviewOverrides`; refuses `invalid-project-pipeline-config`, `unknown-pipeline`, `invalid-pipeline-definition`, and terminal-action without an implement stage. Tests: `project-pipeline-resolution.test.ts`.

`pipeline-stage-resolve.ts` routes stage resolution through `preparePipelineStageWorkflow`. Shared stale-reset preflight from preparation runs for every git-enabled workflow stage (`intent`, `plan`, `implement`), including fan-out branch dispatch, before `dispatchPipelineStage`; refusal fails the stage without dispatch.

## Admission and `PipelineContext`

CLI admission (`admitPipelineStart` in `pipeline-start-admission.ts`) validates seed input, resolves project pipeline config, builds an immutable `PipelineContext`, and RPCs `pipeline_start`. Pre-admission refusals: `invalid-seed-input`, `unregistered-project`, `configuration-read-exception`, `missing-pipeline`, `missing-machine-model-configuration`, `invalid-machine-model-configuration`, `invalid-seed-path`, `invalid-project-pipeline`. Post-contact refusals: `daemon-refusal`, `malformed-daemon-response`, `rpc-transport-failure`, `connection-lifecycle-failure`. Tests: `pipeline-start-admission.test.ts`.

Daemon `pipeline_start` (`handlePipelineStart` in `daemon.ts`) validates RPC `context` through `loadPipelineContext` before `createPipeline` (missing required fields → `invalid_params` with the loader message; no pipeline row or stage rows are created), persists the validated snapshot in the same transaction as definition and stage rows, reloads that snapshot through the same loader, and detaches `runPipeline` from the reloaded bytes — not from the RPC `context` object. It does not re-run `validatePipelineDefinition`. Missing `definition`/`context` → `invalid_params`; context not durably persisted or durable reload failing validation after admit → `admission_failed`.

### `PipelineContext` immutability

`PipelineContext` (`state-store.ts`) is `{ cwd, configPath, targetDir?, projectRegistry?, seed?, seedPath? }` with required `cwd` and `configPath` at admission, stored as JSON on the pipeline row. **Immutability** means the admission snapshot is preserved as written once validated. The store does not enforce mutual exclusivity of `seed` and `seedPath`; dual-populated rows load as stored. At admission, `admitPipelineStart` sets at most one of file `seedPath` or inline `seed` (from CLI `seedText`).

Resolution (`resolveIntentStage` in `pipeline-stage-resolve.ts`): `seedPath` → file `seed`; `seed` → `seedText`; `seedPath` wins when both are present on a loaded row. First workflow stage uses admitted context; later stages load the prior stage entry run (`store.loadRun(artifact.entryRunId)`) and use its `worktreePath` as preset `cwd` when that path is a usable git worktree checkout. When the recorded prior `worktreePath` is absent or only a non-checkout husk, chained downstream-input resolution walks durable roots in order — pipeline admission `context.cwd` (filesystem presence), then prior stage branch (git presence, rematerializing at the recorded `worktreePath` when needed) — before preset build; when both roots carry the path, admission `context.cwd` wins. Plan rebinds `cwd` to admission `context.cwd` when the ready-intent exists there, otherwise rematerializes a checkout at the recorded `worktreePath` from `prior.branch`; implement keeps `baseRef` on `prior.branch` and rebinds `preflightGitRoot` / spec reads to admission `context.cwd` when the spec tree exists there, otherwise rematerializes at the recorded `worktreePath`. A downstream input absent from every durable root refuses with a distinct `pipeline-stage-resolve:` reason (grep `never landed`, standalone re-drive guidance). When the prior worktree checkout is usable, worktree-first resolution is unchanged. Artifact `specPath` stays worktree-relative.

**Persisted context validation:** `loadPipelineContext` (`state-store.ts`) validates `cwd` and `configPath` at every consumption boundary. `persistedContextLoadPermitsContinuation` is the continuation-eligibility gate: `null` is absent (`missing_context` on `continuePipeline`/`resumePipeline` admission only); incomplete JSON that parses is not continuable (`isPipelineContinuable` false, awaiting `resumePipeline` → `pipeline_not_resumable`). Incomplete non-null context on execution reload fails the first pending workflow stage with `failure_detail.message` prefixed by `pipeline-context-loader` and dispatches no workflow run; when every authored stage is already satisfied and terminal publication is pending, the same loader failure records `terminalPublicationFailure` instead of leaving derived `running` with no terminal outcome. Recovery resolution (`resolveBlockedPlanStageRecoveryTarget`) validates through the same loader before stage resolution. Restart continuation and operator resume load context only from the durable row — never caller reconstruction.

## Merge-day dispatch

Production path:

1. `resolveStageWorkflowSteps` (`pipeline-stage-resolve.ts`) — `preparePipelineStageWorkflow` → `prepareWorkflowStart`: posture → preset realization, preset build, machine-config stamping via `stampWorkflowStepsWithMachineConfig`; returns stamped steps (no dispatch-time re-stamping). Chained stages supply `cwd` via `createChainedStageProjectMatch`; pipeline implement review pass count and behavior come from the resolved stage posture.
2. Shared stale-reset preflight from the preparation result (`runStaleResetPreflight` in `advanceWorkflowStage` / fan-out branch dispatch in `pipeline-execution.ts`); guard refusal fails the stage with the same operator text as CLI `run workflow` and dispatches no workflow run.
3. `dispatchPipelineStage` (`pipeline-stage-dispatch.ts`) — `claimPipelineStageAdmission`, `defaultPipelineDispatch` → `handleWorkflowStart` → shared daemon `admitWorkflowStart` → `startWorkflowRun`, `defaultPipelineWait` rollup.

Stage row: `pending` → claim → `running` + `workflowInvocationId` (entry run id). Worktree claim refusal at dispatch records stage `failed`. Tests: `pipeline-stage-dispatch.test.ts`, `pipeline-stage-resolve.test.ts`, `pipeline-workflow-preparation-parity.test.ts`, `pipeline-execution.test.ts` (`runPipeline`, fan-out, stale-reset refusal).

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

**Retry and resume limits:** a `terminalPublicationFailure` is not auto-retried; `pipeline resume` re-attempts it, reloading the linked entry run and preserving its `prNumber`/`prUrl` in the stage artifact so the ready/merge flip can land. Re-settlement that finds the final entry run without a complete PR pair fails with `completion_publication_missing_pr_evidence` and never invokes terminal publication. Because the ready flip is idempotent and PR evidence is never destroyed on failure, a repeated attempt neither re-flips nor loses evidence.

Completion publication (per-stage push/draft/ready during implement) and terminal publication are separate boundaries — `skipReadyFinalization` on implement when `terminalAction` is `leave-draft`. Tests: `terminal-publication.test.ts`, `state-store.test.ts` — `terminal publication commits`, `pipeline-execution.test.ts` — `pipeline terminal publication settlement`.

## Daemon restart continuation

Startup order (`daemon-host.md`): IPC listener → `recoverContinuablePipelines` → `reconcilePipelines` → reconciled run resume.

`recoverContinuablePipelines` (`pipeline-execution.ts`) calls `continuePipeline` for pipelines whose owner is dead and that pass `isPipelineContinuable` or carry `hasRedrivableDeferredSettlement` (excluding entry runs reconciled this boot). `continuePipeline` loads `pipeline.context`, `claimPipelineContinuation`, then `runPipeline`.

`isPipelineContinuable` — requires `persistedContextLoadPermitsContinuation` (complete `cwd`/`configPath`; `null` and incomplete JSON are not continuable). True when `isPipelineSettlementPending`, or derived `pending` with no blocking approval rows and no unreopened `failed` rows (`approvalOutcomePermitsActivation`, `reopenedFailurePermitsActivation`). Does not activate `awaiting-approval` or `rejected` without an explicit decision.

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
| **Admitted** `admitted` | `resolveBlockedPlanStageRecoveryTarget` ok; shared `admitWorkflowStart` admitted (ownership free after stale workflow reclaim, memory headroom); `claimPipelineStageAdmission` won |
| **RPC error** `worktree_claimed` | Queued or live `(project, branch)` ownership held (checked before memory) |
| **RPC error** `insufficient_memory` | Memory headroom refused after ownership admits |
| **Refused** `resolution_refused` | `pipeline_not_found`, `branch_not_found`, `missing_context`, `no_failed_stage`, `stage_not_plan`, `stage_not_linked`, `stage_resolution_failed`, `stage_not_recoverable` |
| **Refused** `stage_claimed` | Another holder owns durable stage admission |
| **Attempt refused** | `recoverPlanStage` — `operator_blocker`, `plan_stage_invalid`, `recovery_requires_git`, etc. (stage stays `failed`) |
| **Succeeded** | Review landing + `reopenFailedPipeline` + stage `succeeded` + `continuePipeline(branchKey)` |

Distinct from `pipeline resume`: recover never invokes plan drafting; `pipeline resume` redispatches the ordinary write step. Tests: `pipeline-stage-recovery.test.ts`; `daemon-pipeline-recover.test.ts`.

After recovery-specific RPC validation and effect-free target resolution, live dispatch and recovery use the same daemon admission order: queued or live ownership after stale workflow-claim reclamation, then memory headroom, common registry/`activeRuns` acquisition, then lifecycle-specific durable admission. Thus ownership is not masked by memory pressure, while invalid recovery input or an unresolvable target returns before the memory check. Any refusal or exception before execution rolls common acquisition and recovery durable admission/log resources back, so the failed target stage stays byte-for-byte unchanged and the attempt does not run; an admitted detached recovery retains its `recovery` active-run identity until attempt, settlement, and continuation finish.

### Wedged `running` stage

Two shapes settle via `resumeDrivesDeferredSettlement` or restart `recoverContinuablePipelines`:

1. Deferred marker — `redrivableDeferredSettlementEntryRunId`.
2. No marker — `unsettledTerminalStageEntryRunId` when entry run rollup is terminally `failed`.

Live entry run → `pipeline_not_resumable`. No-marker wedge on live daemon may need two unscoped resumes (settle, then reopen). See [`operator-runbook.md` § Wedged pipeline-stage settlement](./operator-runbook.md#wedged-pipeline-stage-settlement-after-daemon-death).

## Pending boundaries

Merge-day settlement above is not settled architecture. Pending restructure:

| Target | Tracking artifact | Status |
| --- | --- | --- |
| Run-row-derived settlement | [`pipeline-settlement-derives-from-run-rows`](../spec/seeds/pipeline-settlement-derives-from-run-rows.md) | Pending — ready-intent chain not landed |

Land the documentation spec before that restructure, or replan this page against whichever merged behavior lands first.

## Related docs

- [`workflow-runner.md`](./workflow-runner.md) — preset builders, workflow steps, per-stage completion publication (component scope).
- [`daemon-host.md`](./daemon-host.md) — RPC methods, startup sweep, malformed transport (component scope).
- [`v2-architecture.md`](./v2-architecture.md) — layered model summary.
- [`operator-runbook.md`](./operator-runbook.md) — CLI recipes for start, approve, resume, recover.
