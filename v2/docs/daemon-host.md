# Daemon host IPC

Hermetic Unix-domain-socket transport for the v2 daemon host. Wire shape only in
this slice — run orchestration verbs and log payload semantics land in sibling
work.

See [v2-architecture.md](./v2-architecture.md) Interface for daemon-first
placement; this doc pins the transport contract only.

Operator-facing `jarvis daemon ...` and `jarvis run ...` behavior lives in
[`write-behavior.md`](./write-behavior.md).

Daemon-hosted work, including finalization (the ready gate and draft-to-ready
flip), must not block unrelated IPC. No daemon-hosted path may use a synchronous
child process; `bun run check` guards `v2/**` and `shared/**` against it.

## Restart reconciliation and recovery

Before opening its IPC listener, a daemon marks durable `queued`, `in-progress`,
`paused`, and `budget-soft-stopped` runs whose
**admitting process is gone** as `killed`. Every run row records `owner_identity`
(`<pid>:<process-start-epoch>`, stamped by `createRun` — daemon admission,
`jarvis write`, and the workflow runner all stamp their own process's identity,
not a daemon-specific one). A row is a candidate only if it has no recorded
owner (pre-migration row) or its owner differs from the sweeping process *and*
that owner is no longer alive (pid gone, or pid reused — different start epoch).
A row owned by the sweeping process itself, or by any other still-live process
(a live foreground `jarvis write` or workflow runner, or another daemon),
is left untouched — reconciliation is scoped to dead incarnations, not merely
non-terminal status. Each killed transition appends `run_reconciled` with
`runStatus: "killed"` and `reason: "daemon_restart"`; `jarvis run log <run-id>`
replays that event. `completed`, `blocked`, `failed`, and `killed` rows are
unchanged. State or log reconciliation failure aborts startup before IPC serves.
Reconciliation retains worktrees, branches, attempts, checkpoints, queued input,
and workflow snapshots; it does not reclaim worktrees.

Kill and reconcile never overwrite a boundary-terminal row status (`completed`,
`blocked`, `failed`); `paused` is not boundary-terminal and remains killable.
`run_reconciled` events are emitted only for pending rows whose current status is
`killed` (including a row left `killed` + pending by a crash before the event
append); a pending row that has since reached a boundary-terminal status gets its
pending flag cleared with no reconcile event.

The same pre-IPC block also settles orphaned pipelines: an `active` pipeline
owned by a dead or absent prior incarnation is marked `interrupted`, and each of
its active stages (`pipeline_stages.status` outside `pending`, `awaiting`,
`approved`, `rejected`, and outside the terminal/blocked-suffix set
`succeeded`/`failed`/`interrupted`/`skipped`) is marked `interrupted` alongside
it, preserving completed stages and leaving undispatched (`pending`), decided
approval rows, and blocked-suffix (`skipped`) rows untouched. A pipeline owned by
the sweeping process or another still-live process is left unchanged, and an
already-`interrupted` pipeline is never a candidate (idempotent across
restarts). Startup only settles orphans — it does not re-dispatch or re-admit
them. Pipeline reconciliation failure aborts startup before IPC serves, same as
run/log reconciliation failure.

Once IPC is listening, the daemon automatically admits every row that this
startup sweep reconciled through the normal snapshot-backed write `resume`
path. Health and all other IPC calls remain available while the resumed work
runs. Recovery reuses the durable run ID, workflow snapshot, worktree, and
branch. Each successful admission appends `run_recovery` with `outcome:
"resumed"`. A snapshot-less or otherwise unresolvable row is not admitted and
stays `killed` with `unsupported_resume_context`. Any other admission failure
sets that row to `failed` and appends `run_recovery` with `outcome: "failed"`
and its diagnostic; it does not block later reconciled rows.

## Socket path

Callers supply `socketPath` explicitly. There is no production default,
stale-socket recovery, or max concurrent client cap in the library. The CLI,
[`jarvis tui`](./write-behavior.md#tui-cli) (IPC `start` consumer over the
production socket), [`jarvis tui log <run-id>`](./write-behavior.md#tui-cli)
(IPC tail consumer over the same socket), and daemon lifecycle commands key
socket, PID, and process-log paths by the invoking executable digest: derived
from the SHA-256 digest of tracked blobs under `v2/src/**`, `shared/**`, and
repo manifests, with a 16-hex-char leading slice to stay within the macOS
`sun_path` limit (104 bytes). The keyed path format is `~/.jarvis/daemon-<key>.sock`,
`~/.jarvis/daemon-<key>.pid`, and `~/.jarvis/daemon-<key>.log`. This allows
multiple daemons keyed by different executable digests to coexist: each connects
to its own socket, PID file, and process log, with no interference.

Multiple daemons coexisting by keyed socket create a corresponding accumulation
of sockets: one per executable digest ever run. Under one shared `JARVIS_HOME`,
durable run rows are shared across keyed daemons — a row created by one daemon is
visible to all daemons querying the same state store. Liveness (`isLive`) and live
controls (`pause`, `kill`) are scoped to the owning daemon only: a run launched by
daemon A remains `isLive: true` only in A's responses until the loop settles.

When a new daemon starts (after rebuilding the executable, for example), it sends
a `supersede` RPC to every other `daemon-<key>.sock` in `~/.jarvis`, best-effort
and non-blocking: supersede sends are fire-and-forget after the new daemon's own
server is listening, do not gate startup, and errors (unreachable socket, RPC
failure) are ignored. A superseded daemon continues answering on its socket but
stops admitting new work: new `start`/`resume` requests on a superseded socket
fail with code `daemon_superseded`. Runs launched by a superseded daemon remain
in-progress until settled; once settled, the daemon disappears on its own as
callers switch to the new keyed socket.

`jarvis cleanup` removes dead sockets (those whose listeners have exited) via a
connect-attempt probe: if the probe receives `ECONNREFUSED` or `ENOENT`, the socket
is dead and removed; all other error states (timeout, permission error, unexpected
error) preserve the socket and are reported. Live sockets — those a daemon is
currently answering on, whether the invoking digest or a superseded keyed daemon —
are never removed.

### Socket discovery

Observers enumerate live coexisting daemons by discovering live sockets: enumerating
`daemon-<key>.sock` entries under `~/.jarvis`, probing each for liveness via a
`health` RPC call (which succeeds immediately if a daemon is running and listening),
and collecting those that respond within a short timeout. Only sockets that answer
`health` successfully are considered live; stale socket files that do not connect are
excluded. Discovery returns results in lexicographic order for deterministic
enumeration.

`jarvis run list`, `jarvis run log`, and `jarvis run wait` union discovered live
sockets with the invoking digest's socket, issue `list` on each (skipping sockets
whose `list` fails), merge rows by run ID with `isLive` preference, and use the
owning socket for log streams and `wait`. Bulk `jarvis cleanup` eligibility uses the
same socket query set and skip-on-failure semantics for `list`-based live-run checks
(not for `--abandon` or stale-reset claim probes, which remain keyed-socket only).
When no queried daemon lists the run,
`log` and `wait` fall back to the invoking socket (same as before a digest
rotation).

## Framing

One connection carries length-prefixed UTF-8 JSON frames:

1. Four-byte big-endian unsigned length of the JSON body.
2. UTF-8 JSON object body.

Framing failures — bad length (over cap), truncated body, invalid JSON — close
the connection. The listener keeps serving other clients.

## Envelope `kind` union

| `kind` | Role |
| --- | --- |
| `request` | RPC call: `{ kind, id, method, params? }` |
| `response` | RPC success: `{ kind, id, result }` |
| `error` | RPC failure: `{ kind, id, code, message }` |
| `stream-open` | Open multiplexed stream: `{ kind, streamId, payload? }` |
| `stream-data` | Stream chunk: `{ kind, streamId, payload? }` (`payload` is base64 bytes) |
| `stream-end` | Close stream: `{ kind, streamId, payload? }` |

Request/response pairs correlate by `id`. `error` carries the same `id` when
replying to a request.

Valid JSON with missing or invalid `kind` closes the connection.

## RPC methods (transport slice)

| `method` | `params` | `result` | Meaning |
| --- | --- | --- | --- |
| `health` | — | `{ ok: true }` | Channel liveness |
| `status` | — | `{ state: "running", loadedRevision: string, loadedExecutableDigest: string, recovery: { pending: boolean, reconciled: number, resumed: number } }` | Daemon-host liveness only — not run orchestration status. `loadedRevision` is the daemon's recorded Git HEAD at startup. `loadedExecutableDigest` is the SHA-256 digest of tracked blobs under `v2/src/**`, `shared/**`, and repo manifests at daemon boot. `recovery` is pending until all startup admissions finish; then its stable counts name rows reconciled and successfully auto-resumed. Unsupported and failed admissions are not resumed. |
| `supersede` | — | `{ ok: true }` | Marks this daemon as superseded by a newer executable. A superseded daemon continues answering on its socket but stops admitting new work: subsequent `start` and `resume` calls are rejected with code `daemon_superseded`. Called by a starting daemon after its server is listening, best-effort and non-blocking (errors are ignored). |
| `start` | `{ input: WriteLoopInput } \| { steps: AnyWorkflowStep[] }` | `{ runId: string }` | Exactly one of `input`/`steps`; both, neither, or an empty `steps` array is rejected `invalid_params`. `{ input }` spawns a write loop in the background, or persists it `queued` if memory headroom is unavailable; returns immediately with run ID either way (see [Admission guards](#admission-guards-for-start-and-resume)). Rejected `daemon_superseded` if the daemon is retiring (see [Daemon retirement on supersession](#daemon-retirement-on-supersession)). Rejected `worktree_claimed` if an existing queued run holds the `(project, branch)` key, or if memory headroom is clear and the key is claimed by a live run. `{ steps }` dispatches to `executeWorkflow` with `freshDispatch: true`, creating new run rows for every step and minting a fresh `invocationId`; prior `completed` runs are not reused. A linked implement first materializes and validates its managed worktree; failure returns `worktree_materialization_failed` with that path and the Git or validation reason, before routing or a run row. Returns `{ runId }` for step 0 once its run row is durably created; the workflow then keeps running in the background. A `firstStep.workflowInvocationId` request whose prior run is non-terminal (`in-progress`, `paused`, `budget-soft-stopped`) and owned by another invocation is rejected `worktree_claimed` (intent ownership guard). Terminal prior runs (`completed`, `failed`, `blocked`, `killed`) do not block a fresh request, allowing new runs to start. Rejected `insufficient_memory` (not queued) if memory headroom is unavailable at call time. Other failures before step 0's run row exists (e.g. an invalid step shape) return an error rather than hanging, surfacing `executeWorkflow`'s thrown message as `invalid_params`. |
| `list` | `{ sinceMs?: number; limit?: number; project?: string; branch?: string; specPath?: string; status?: RunStatus }` | `{ runs: Array<{runId, project, branch, createdAt, status, isLive, loopOutcomeKind?, iterationsConsumed?, resumable?, error?, reviewPasses?, reviewBehavior?, workflow?, stepId?, finishedAtMs?, prNumber?, prUrl?}> }` | List durable runs merged with in-memory liveness; `isLive=true` only while the loop's Promise is executing. After spawn-boundary executor failure: `status: "failed"`, `isLive: false` (see [Spawn-boundary failure capture](#spawn-boundary-failure-capture)). `createdAt` is the durable run admission timestamp (ms since epoch). Optional outcome fields; optional `error` on non-success terminals (see [Operator error on list and wait](#operator-error-on-list-and-wait)). Optional `prNumber` and `prUrl` when publication confirmed a PR. `stepId` names the durable workflow step when the row backs a snapshot step; omitted on ordinary single-step runs. `finishedAtMs` is the latest finish timestamp for terminal statuses (`completed`, `failed`, `blocked`, `killed`, `interrupted`): the maximum of non-null attempt `completed_at` values and non-null `reconciledAt`; omitted while the run is non-terminal or when neither source has a finish timestamp — clients such as `jarvis tui` use it for live terminal-window filtering, not for default CLI list retention. Workflow-backed rows may also carry authored per-step progress (see [Workflow snapshots on list rows](#workflow-snapshots-on-list-rows)). Implement workflow rows may also carry retained `reviewPasses` and `reviewBehavior` (see [Implement review selection on list rows](#implement-review-selection-on-list-rows)). For workflow entry rows (the returned run id from a `start { steps }` invocation), `status` reflects a rollup over all steps in the invocation: the first authored durable step's terminal-but-not-completed status, `killed` if an authored durable step has no row in a non-live invocation, or `completed` if all authored durable steps are completed; while the workflow is live, status is `in-progress` regardless of step row state. When a stopping sibling owns the terminal outcome, entry `loopOutcomeKind`, `iterationsConsumed`, and `error` come from that sibling, while `resumable` remains eligible only when the entry row itself can resume. Other step rows in that workflow report their own durable statuses. Terminal runs (`completed`, `failed`, `blocked`, `killed`, `interrupted`) are bounded to the 50 newest by creation time; all other statuses are exempt and always returned. Step runs of a listed workflow invocation are retained with that invocation regardless of the bound. Retention filters the response only — durable rows are kept (see [Terminal run list retention](#terminal-run-list-retention)). When any list filter field is set (`sinceMs`, `project`, `branch`, `specPath`, or `status`), matching durable rows are returned newest-first and terminal retention is bypassed; dimension filters match store columns exactly and compose conjunctively with each other and with `sinceMs`; the response is capped to `limit` when provided or **200** when omitted. `limit` alone does not select the filtered path. |
| `pause` | `{ runId: string }` | `{ ok: true }` | Signal graceful pause for an active run. The run continues at the next iteration boundary (in-flight step is not aborted). Rejected `run_not_active` if run is unknown, not active, or is a workflow-started run (see [Live controls on workflow-started runs](#live-controls-on-workflow-started-runs)). |
| `kill` | `{ runId: string }` | `{ ok: true }` | Abort the run's signal immediately and record durable status `killed` when the row is not boundary-terminal (`completed`, `blocked`, `failed`). Workflow-started rows defer that record until invocation/repair quiescence and both worktree ownership layers release. Leaves the worktree dirty. Accepts any live run, including workflow-started step rows (see [Live controls on workflow-started runs](#live-controls-on-workflow-started-runs)). Rejected `run_not_active` if run is unknown or not active. |
| `resume` | `{ runId: string }` | `{ ok: true }` | Resumes workflow write runs when shared snapshot reconstruction succeeds and the same admission predicate that projects `list`/`wait` `resumable` (`nextAction: "resume"` on the composed operator error; see [Operator error on list and wait](#operator-error-on-list-and-wait)). Rejected `daemon_superseded` if the daemon is retiring (see [Daemon retirement on supersession](#daemon-retirement-on-supersession)). The matching persisted step must retain non-empty rules, artifact path, agents, model config, and resolvable bindings; the reconstructed input preserves step identity, workflow snapshot, and timeout. Missing or invalid context returns `resume_unsupported` before claim/spawn. Accepted reasons include every composition that yields `nextAction: "resume"` (e.g. `resumable_pause`, `resumable_budget`, `resumable_kill`, `completion_commit_failed`, `ready_gate_failed`, `surviving_mutation_failed`, `landing_failed`, `invalid_token`, `missing_blocker`, resumable `contract_miss` on `implement~shrink`); compositions yielding `nextAction: "stop"` / `"inspect_spec"` / `"fix_config"` / `"retry_later"` are rejected with `terminal_run` whose message names the owning recovery from `RUN_OPERATOR_ERROR_RECOVERY` (see `run-operator-error.ts`). Ad-hoc stopped runs remain unsupported. A row owned by a durable review-behavior step (a durable `implement-review`, or a durable `review-debate` last step — never a non-durable light `implement-review` sharing that step ID) whose terminal `loop_finished` names `surviving_mutation_failed`, `ready_gate_failed`, or `completion_commit_failed` does not go through this snapshot-field reconstruction — its own `stepRules`/`expectedArtifactPath` are review-shaped, not write-shaped. It resolves through completion-step / publication-tail reconstruction instead: the durable write step's completed sibling row is resolved by workflow `invocationId`, matching either the authored write stepId or a completed `<stepId>~link-N` row (the shape a linked-implement workflow's terminal pass persists), picking the terminal completed candidate when several exist. That selected row supplies the publication `worktreePath`, base ref, and `specPath`; conflicting fields recorded on the review row itself never override it. Resume then commits any uncommitted worktree changes and replays mutation re-verification, the ready gate, and publication without re-invoking the completed write step's agent. The other two outcome kinds are admitted for self-consistency — only this same resume path ever writes them onto a review-behavior row — not because a fresh review pass can settle them; `runtime_smoke_failed` from this same tail is excluded (retrying cannot change that outcome) and reports `unsupported_resume_context` instead, even when its own `loop_finished` record says `resumable: true`. |
| `wait` | `{ runId: string }` | `{ runStatus, loopOutcomeKind?, iterationsConsumed?, resumable?, error? }` | Long-running one-shot wait for the next invocation boundary. On a workflow entry, whichever durable sibling row owns the rollup `surviving_mutation_failed` — a hidden `~shrink` row or a durable review row alike — supplies outcome fields and error detail (chronologically last terminal record wins among multiple candidates); entry resumability remains tied to the entry row. Unsupported stopped write context returns `error: { reason: "unsupported_resume_context", retryable: false, nextAction: "stop" }` and forces `resumable: false`, even when the historical loop record was resumable. Otherwise behavior is unchanged; optional `error` matches `list` for the same run (see [Operator error on list and wait](#operator-error-on-list-and-wait)). |
| `pipeline_start` | `{ definition: PipelineDefinition, context: PipelineContext }` | `{ pipelineId: string }` | Admit a validated pipeline definition plus execution context: durably record the supplied immutable `context` on the pipeline row in the same transaction as the definition and stage rows, start the ordered daemon-owned loop (`runPipeline`), and return `{ pipelineId }` only after that admission transaction succeeds and the context round-trips on reload — not when the pipeline finishes. Missing `definition` or `context` → `invalid_params`. Context supplied but not durably persisted → `admission_failed` (no pipeline ID returned). The handler does not re-run `validatePipelineDefinition`; callers must validate before RPC. See [Ordered pipeline progression](#ordered-pipeline-progression). |
| `pipeline_approve` | `{ pipelineId: string, stageId: string, branchKey?: string }` | `{ kind: "applied", pipelineId, stageId, decision: "approved" } \| { kind: "refused", pipelineId, stageId, reason }` | Admit `approved` on the authored `stageId` row through `commitApprovalDecision`, then asynchronously continue the ordered loop from persisted admission context when the write applies. Optional `branchKey` targets one branch row; when multiple non-`skipped` branch rows exist at the stage and `branchKey` is omitted, the handler refuses with `branch_key_required`. Missing/empty `pipelineId` or `stageId` → `invalid_params`. Retiring daemon → `daemon_superseded`. Refused store outcomes (`pipeline_not_found`, `stage_not_found`, `not_approval_stage`, `status_not_awaiting`, etc.) return unchanged with no dispatch. Duplicate or racing decisions are refused without a second continuation. The handler resolves after the durable write, not after continuation finishes. See [Pipeline approval decisions](#pipeline-approval-decisions). |
| `pipeline_reject` | `{ pipelineId: string, stageId: string, branchKey?: string }` | `{ kind: "applied", pipelineId, stageId, decision: "rejected" } \| { kind: "refused", pipelineId, stageId, reason }` | Admit `rejected` on the authored `stageId` row through `commitApprovalDecision` and never dispatch later stages for that branch. Optional `branchKey` targets one branch row; when multiple non-`skipped` branch rows exist at the stage and `branchKey` is omitted, the handler refuses with `branch_key_required`. Missing/empty `pipelineId` or `stageId` → `invalid_params`. Retiring daemon → `daemon_superseded`. Refused store outcomes (`pipeline_not_found`, `stage_not_found`, `not_approval_stage`, `status_not_awaiting`, etc.) propagate without mutation or dispatch. The handler resolves after the durable write. See [Pipeline approval decisions](#pipeline-approval-decisions). |
| `pipeline_resume` | `{ pipelineId: string }` | `{ kind: "resumed", pipelineId } \| { kind: "refused", pipelineId, reason }` | Stage-scoped resume for failed and `awaiting-approval` pipelines only. Missing/empty `pipelineId` → `invalid_params`. Retiring daemon → `daemon_superseded`. Derived `succeeded` → `pipeline_terminal_succeeded`; derived `rejected` → `pipeline_terminal_rejected`; derived `running`, fresh `pending`, or `interrupted` → `pipeline_not_resumable` — each without stage dispatch. Derived `failed` applies `reopenFailedPipeline` when a `failed` row remains, then asynchronously continues via `continuePipeline` from persisted admission context; already-reopened failures (`reopenedFailurePermitsActivation`, derived `pending`) skip reopen and continue only the eligible failed stage while preserving every predecessor `workflowInvocationId`. Derived `awaiting-approval` claims ownership via `claimPipelineContinuation` but never calls `continuePipeline` — the gate row stays `awaiting` with no later dispatch; missing persisted admission context → `missing_context`; `claimPipelineContinuation` refusal → `claim_refused`. `isPipelineContinuable` and startup `recoverContinuablePipelines` do not treat awaiting pipelines as continuable. Ineligible failed shapes surface the store reopen refusal (`no_failed_stage`, `multiple_failed_stages`, `malformed_continuation`, etc.) without dispatch. The handler resolves after reopen and/or claim admission (or refusal), not after detached continuation finishes. See [Pipeline stage-scoped resume](#pipeline-stage-scoped-resume). |
| `pipeline_list` | — | `{ pipelines: Array<{ pipelineId, name, state, terminalAction?, seedPath?, terminalPublicationSucceededAt, terminalPublicationFailure, createdAt, finishedAtMs, stages: Array<{ id, stageId, branchKey, position, status, workflowInvocationId, startedAt, endedAt, artifact, failureDetail }> }> }` | Parameterless durable snapshot of every admitted pipeline without following live transitions. Empty store → `{ pipelines: [] }`. `terminalAction` is the admitted definition value; `seedPath` is the unchanged durable admission-context value and may be relative to admission `cwd`, which is not exposed. Either optional field is omitted when absent. Terminal-publication fields and stage `artifact`/`failureDetail` preserve durable JSON `null`; publication success/failure are mutually exclusive. `createdAt` is the durable pipeline row admission timestamp (ms). `finishedAtMs` is `null` while derived `state` is non-terminal; for terminal states it is `terminalPublicationSucceededAt` when set, otherwise the maximum non-null stage `endedAt`, otherwise `createdAt`. Stage `startedAt` and `endedAt` are milliseconds since epoch and `null` when unset. Stage order follows stored authored `position` then `branch_key`. Derived `state` uses `derivePipelineState` (see [Pipeline snapshots](#pipeline-snapshots)). |
| `pipeline_wait` | `{ pipelineId: string }` | `{ kind: "terminal", state } \| { kind: "awaiting-approval", stageId, branchKey }` | Block until the named pipeline reaches a wait boundary or the request `AbortSignal` aborts. Returns immediately when already at a boundary. Missing/empty `pipelineId` → `invalid_params`; unknown ID → `unknown_pipeline` (no wait begins). Abort throws `pipeline_wait aborted` with no boundary payload. Other failures propagate without masking as abort. See [Pipeline wait](#pipeline-wait). |

Unknown `method` returns `error` correlated to the request `id` (connection
stays open).

Entry `list` uses the same outcome selection while retaining the workflow rollup status.

### Terminal run list retention

`list` returns at most the 50 newest terminal runs — statuses `completed`,
`failed`, `blocked`, `killed`, and `interrupted` — ordered by `created_at` descending with
`rowid` as a tiebreak. All other statuses (`in-progress`, `queued`, `paused`,
`budget-soft-stopped`) are exempt: they are always
returned and do not consume retention slots.

When a workflow invocation has any retained run, every step run sharing that
invocation's `workflowSnapshot.invocationId` is retained too, including
terminal step runs older than the 50-newest terminal bound. Companion step runs
do not consume retention slots.

When any list filter field is set on `list` (`sinceMs`, `project`, `branch`,
`specPath`, or `status`), both the 50-newest terminal cap and
invocation-sibling retention are skipped. Matching durable rows are returned
newest-first (`created_at DESC`, `rowid DESC`), then capped to `limit` when
provided or **200** when omitted. `project`, `branch`, `specPath`, and `status`
each match the durable store column exactly (case-sensitive) and compose
conjunctively with each other and with `sinceMs`. For `sinceMs`, matching means
`created_at >= sinceMs`. Durable rows are still not deleted; only the response
is filtered.

`limit` without a filter field does not enter this path; the daemon does not use
`limit` to reduce row count on the retention path. See [Terminal run list
retention](#terminal-run-list-retention) for the default list behavior.

Retention is applied to the durable row set before per-row `loadRun` and log
replay, so retired runs are not loaded while serving `list`. Durable rows are
not deleted — `loadRun` and other store reads still return retired runs.
`jarvis run list` and `jarvis tui` render every run the daemon returns and apply
no bound of their own.

### Wait result contract

`wait` validates `params.runId` before reading logs. Missing or empty `runId`
returns `invalid_params`; unknown runs return `unknown_run`. A linked implement
materialization failure before routing or step 0's row exists returns
`worktree_materialization_failed`, with the managed worktree path and underlying
Git or validation reason. A later routing-index read returns `routing_read_failed`,
with the resolved index path and underlying read reason; other pre-row
rejections remain `invalid_params`.

The response is deferred on the same request `id` while a run is in progress.
Other RPCs on that connection continue to receive normal correlated responses
while the wait is pending. Disconnecting the socket detaches only that waiter:
no response is sent for the abandoned request, the durable run is unchanged, and
other waiters for the same run continue.

Result fields:

- Always present: `runStatus`, re-read from durable state at resolve time.
- Present when the terminal signal is `loop_finished`: `loopOutcomeKind`,
  `iterationsConsumed`, `resumable`, and optionally `prNumber` and `prUrl` when
  the run's publication confirmed a PR.
- Omitted when resolving from `run_execution_failed`, kill-before-log, or a
  durable terminal row without a persisted `loop_finished`.
- Optional `error` — stable operator stop detail; omitted on in-progress runs and
  successful `completed` terminals. Same object shape and composition rules as
  `list` rows.

### Operator error on list and wait

When a run is not a clean in-progress or success terminal, `list` rows and `wait`
results may include:

```json
{ "reason": "<closed-reason>", "retryable": false, "nextAction": "<closed-action>" }
```

No stderr, exit codes, or attempt transcripts appear in this contract.

| Field | Meaning |
| --- | --- |
| `reason` | Closed stop category (not raw `failureKind` or `loopOutcomeKind`) |
| `retryable` | Whether the operator may retry/resume without fixing underlying state |
| `nextAction` | Closed remediation hint (`resume` \| `inspect_spec` \| `fix_config` \| `retry_later` \| `stop`) |

| `reason` | Typical inputs | `retryable` | `nextAction` |
| --- | --- | --- | --- |
| `resumable_pause` | `runStatus: "paused"` or `loopOutcomeKind: "paused"` | `true` | `resume` |
| `resumable_budget` | `runStatus: "budget-soft-stopped"` or `loopOutcomeKind: "budget-exhausted"` | `true` | `resume` |
| `resumable_kill` | `runStatus: "killed"` (wins over conflicting `loop_finished`) | `true` | `resume` |
| `agent_blocked` | `loopOutcomeKind: "blocked"` or store `blocked` + attempt `outcome_kind: "blocked"` | `false` | `inspect_spec` |
| `contract_miss` | attempt `outcome_kind: "contract_miss"` or non-resumable terminal `loop_finished` with `loopOutcomeKind: "contract_miss"` | `false` | `inspect_spec` |
| `contract_miss` | terminal `loop_finished` with `loopOutcomeKind: "contract_miss"` and `resumable: true` (post-commit shrink miss on `implement~shrink`, typically `runStatus: "paused"`) | `true` | `resume` |
| `invalid_token` | attempt `outcome_kind: "invalid_token"` | `true` | `resume` |
| `missing_blocker` | attempt `outcome_kind: "missing_blocker"` | `true` | `resume` |
| `quota_exhausted` | binding-chain `invocation_failure` + `failureKind: "quota"` | `false` | `retry_later` |
| `model_config` | binding-chain `invocation_failure` + `failureKind: "model_config"` | `false` | `fix_config` |
| `no_binding` | binding-chain `invocation_failure` + `failureKind: "no_binding"` | `false` | `fix_config` |
| `invocation_error` | binding-chain `invocation_failure` + `failureKind: "error"` or legacy null detail | `false` | `stop` |
| `role_timeout` | review-step `invocation_failure` + `failureKind: "timeout"`, not exhausted | `true` | `retry_later` |
| `role_timeout` (exhausted) | review-step `invocation_failure` + `failureKind: "timeout"` + `exhaustedRoleTimeout: true` (every configured rung timed out) | `false` | `stop` |
| `role_stalled` | review-step `invocation_failure` + `failureKind: "stall"` | `true` | `retry_later` |
| `iteration_timeout` | failed `loopOutcomeKind: "iteration_timeout"` | `false` | `stop` |
| `idle_output_timeout` | write-step attempt `outcome_kind: "idle_output_timeout"` or failed `loopOutcomeKind: "idle_output_timeout"` | `false` | `stop` |
| `harness_failure` | terminal `run_execution_failed` without a post-boundary lock message, or `failed` without mappable attempt detail | `false` | `stop` |
| `state_store_lock_timeout` | terminal `run_execution_failed` whose `message` names SQLite lock contention after a committed write-step `done` boundary | `true` | `resume` |
| `unsupported_resume_context` | stopped or publication-retry write run whose snapshot cannot reconstruct an executable step | `false` | `stop` |
| `completion_commit_failed` | `loopOutcomeKind: "completion_commit_failed"` on a `failed` row | `true` | `resume` |
| `ready_gate_failed` | `loopOutcomeKind: "ready_gate_failed"` on a `failed` row | `true` | `resume` |
| `ready_gate_out_of_scope` | `loopOutcomeKind: "ready_gate_out_of_scope"` on a `failed` row | `true` | `resume` |
| `surviving_mutation_failed` | `loopOutcomeKind: "surviving_mutation_failed"` on a `failed` row | `true` | `resume` |
| `ready_flip_failed` | `loopOutcomeKind: "ready_flip_failed"` on a `completed` row | `false` | `stop` |

For `completion_commit_failed`, `error.publicationFailure` on both `list` and `wait` contains the failed operation, message, exit code, and bounded labelled stdout/stderr tails from the terminal `loop_finished` row. `ready_flip_failed` is terminal non-resumable and also carries `error.publicationFailure` from that row; `completion_commit_failed`, `ready_gate_failed`, and `ready_gate_out_of_scope` are retryable. `ready_gate_failed` and `ready_gate_out_of_scope` do **not** populate `error.publicationFailure` — gate evidence lives on the terminal `loop_finished` row (`readyGateError` message; inspect with `jarvis run log`). For `ready_gate_out_of_scope`, `error` also carries `readyGateOutsidePaths` and `readyGateOutOfScopeDetail` from that row and guides retry finalization via `jarvis run resume` (not source repair). For `surviving_mutation_failed`, `error` also carries `survivingMutation`, `survivingMutationSourceFile`, and `survivingMutationSourceLine` from the terminal `loop_finished` row. For `contract_miss`, `error.contractMissDetail` carries the chronologically last `contract_miss_detail.failureReason` from the run log when the log tail is readable; omitted when `logReader` is absent (store-only composition) or when the chronologically last `contract_miss_detail` lacks `failureReason`. `jarvis run log` remains the full excerpt. When `ready_flip_failed` occurs after the publisher returned a PR number, `error.prNumber` on `list` and `wait` identifies the PR for manual fixing; omitted when publication returned no PR.

A failed hidden shrink publication row remains `failed` and resumable; the workflow entry row rolls up to `failed` rather than `completed`.

Every publication-tail outcome, `surviving_mutation_failed` included, settles on the workflow's durable completion row regardless of which step actually produced it — status per outcome is as listed above. A non-durable last step (e.g. a light review with no landing) redirects the tail to the completion step's hidden `~shrink` row when one exists, else that step's own row, so the terminal record always lands on a row `list`/`wait` can see.

**Omission:** `error` is absent on `in-progress` runs and on `completed` runs with
no operator-actionable stop.

**Composition:** `composeRunOperatorError` reads durable `loadRun`, the chronologically
last terminal log record (`loop_finished` or `run_execution_failed` — whichever ended
the current quiescent state), and an optional log-tail record list. `list` replays
persisted logs per row via injected `logReader` (no `follow`) and passes that tail into
the composer; `contractMissDetail` is sourced from the chronologically last
`contract_miss_detail` in that tail when the row composes to `contract_miss`. When
`logReader` is absent (tests), `list` composes store-only without the tail and does not
fail the RPC — `contractMissDetail` is omitted. `wait` and `list` share one composer,
one terminal-selection rule, and the same log-tail enrichment path when the tail is
available.

**Tie-break:** Attempt `outcome_kind: "invalid_token"` or `"missing_blocker"` wins over generic
`resumable_pause` when `runStatus: "paused"`. A terminal `loop_finished` with
`loopOutcomeKind: "contract_miss"` and `resumable: true` composes to `contract_miss` /
`resume` (post-commit shrink miss). Durable `runStatus` wins for resumable terminals (`killed`, `paused`,
`budget-soft-stopped`). For `failed` / `blocked`, a terminal `loop_finished` with `resumable: true` and
`loopOutcomeKind` in `ready_gate_failed`, `ready_gate_out_of_scope`, `surviving_mutation_failed`, `completion_commit_failed`, or
`iteration_commit_failed` outranks last-attempt store detail; otherwise last-attempt detail wins over conflicting
`loop_finished` (e.g. `runStatus: "failed"` + `loopOutcomeKind: "complete"` resolves from attempt detail). When
`runStatus` is `failed` or `blocked` with no mappable attempt detail, resumable `loopOutcomeKind` values from stale
logs for durable-status kinds (`paused`, `budget-exhausted`, `killed`, etc.) do not win — operators see a
non-resumable stop (typically `harness_failure`). Spawn-boundary failure on resume can demote
`budget-soft-stopped` to `failed`; after demotion, `error` follows `failed` rules
and does not regress to `resumable_budget` from an earlier budget `loop_finished`
when a later `run_execution_failed` is the selected terminal. Message-less
`run_execution_failed` records (spawn-boundary reporter) still compose
`harness_failure`; only a lock message after a committed `done` boundary maps to
`state_store_lock_timeout`.

**`error.retryable` vs `wait.resumable`:** `error.retryable` is the
operator-action signal on the error contract. `list` and `wait` project
`resumable` from the same admission predicate that gates `resume`
(`nextAction: "resume"` on the composed operator error), so advertised
`resumable` and resume admission agree by construction. Unsupported snapshot
context still forces `resumable: false` on the row (and `nextAction: "stop"` on
the surfaced error) even when the historical `loop_finished` record was
resumable. The persisted `loop_finished` event in `jarvis run log` is unchanged
— the loop's settle-time self-report, not the row contract. `resumable` may be
absent on store-only quiescent resolves that carry no terminal `loop_finished`
fields (e.g. `killed` without persisted loop outcome).

Malformed `error` fields reject the entire `list` / `wait` payload (strict
`daemon-wire` parsing).

### Workflow snapshots on list rows

Workflow-backed `list` rows may include:

```json
{
  "workflow": {
    "invocationId": "inv-123",
    "steps": [
      {
        "stepId": "step-1",
        "role": "implement",
        "status": "completed",
        "attemptCount": 2,
        "terminalOutcome": "complete"
      }
    ]
  }
}
```

Rules:

- Omitted on single-step runs.
- `invocationId` ties every step run in one workflow dispatch to the same invocation; all rows sharing it carry the same authored `steps[]` snapshot (see [Terminal run list retention](#terminal-run-list-retention)).
- `steps[]` stays in authored workflow order from the durable workflow snapshot
  stored on that run.
- Each step carries `stepId`, `role`, `status`, `attemptCount`, and optional
  `terminalOutcome`.
- `status` is closed: `pending | in_progress | completed | stopped`.
- `terminalOutcome` is present only for terminal steps:
  `completed -> "complete"` and
  `stopped -> "blocked" | "contract_miss" | "invocation_failure" | "budget-exhausted" | "paused" | "killed"`.
- `attemptCount` counts started durable attempts for that step, including an
  active in-progress attempt. Durable write and review-debate rows source this
  from `run.attempts.length`. Non-durable `review` steps keep `attemptCount: 0`
  while `in_progress`; settled (terminal) non-durable review steps report the
  invocation count the workflow runner recorded for that step (`>= 1` after an
  agent role started).
- When the entry row's rollup `status` is `completed`, no authored step may
  project `pending`. Later unstarted steps on early-stop terminal rollups
  (`blocked`, `failed`, `killed`, etc.) remain `pending`.
- Non-durable review progress is in-process only. Terminal review progress is
  frozen when the workflow runner reports a settled step; live progress is cleared
  when the invocation's background work finishes. If live progress was cleared
  without a freeze, a completed-rollup guard still suppresses `pending` on
  non-durable review steps (role/outcome/count may be hollow without the freeze).
  Frozen snapshots survive live-map clearing but not daemon restart.
- Live snapshots expose at most one `in_progress` step; quiescent snapshots
  expose none.
- `invocation_failure` is also the fallback outcome for a step run left
  `in-progress` with no live daemon entry (e.g. a crash-orphaned run); the
  closed vocabulary has no dedicated status for that case.
- Renders identically whether the workflow run was produced by `{ steps }`
  dispatch or by `{ input }` (`start`) carrying a `workflowSnapshot`/`stepId` —
  same row shape, same rules.

### Implement review selection on list rows

Implement workflow `list` rows may include top-level `reviewPasses` and
`reviewBehavior` fields copied from the durable workflow snapshot at launch
time:

```json
{
  "runId": "run-1",
  "project": "demo",
  "branch": "feature",
  "status": "in-progress",
  "isLive": true,
  "reviewPasses": 2,
  "reviewBehavior": "light",
  "workflow": { "steps": [ ... ] }
}
```

Rules:

- Present only on implement workflow runs; non-implement workflow rows omit
  `reviewPasses` and `reviewBehavior` entirely (not `null`).
- `reviewPasses` is always numeric when present, including explicit no-review
  launches (`0`).
- `reviewBehavior` is always `"debate"` or `"light"` when present, including
  review-free launches.
- Sourced from the workflow snapshot on the run row, not from live project
  configuration or the emitted step list.
- TUI run data uses the same top-level fields on each `list` row.

### Live controls on workflow-started runs

`activeRuns` entries carry a `kind` discriminant: `write-loop` for bare `start`
(`{ input }`) runs, `workflow` for runs started via `{ steps }`. A workflow
invocation registers one shared `AbortController` on the claim row plus a
`workflow`-kind entry for every step `runId` as each row is durably created
(`onStepRunCreated`); those entries stay until the invocation's background work
finishes and `.finally` bulk-deletes them — not only while a given step is
in-flight. The claim row is not an operator `kill` target id (after `start`
returns, step 0's `runId` is the entry id).

`kill` succeeds when `activeRuns` holds a `workflow` row whose `runId` equals
the argument (same lookup shape as write-loop: ownership key, then run id).
Authorization is that live row only — no stall, idle-age, or subprocess
inference. `list` `isLive` is durable `in-progress` ∧ membership in the live
set from `activeRuns`; when `isLive` is true for a step id, `kill` must
succeed. The converse is not required: a row may remain in `activeRuns` briefly
after durable status is no longer `in-progress` during unwind.

`kill` on an authorized workflow row aborts the shared controller (stopping
in-flight agent work on any still-running step) and queues `commitGuardedKill`
for the **named** `runId` only. The commit runs after the invocation and any
finalization repair quiesce and the managed `.jarvis.lock` is released; the
daemon registry claim releases immediately after, so `killed` is durable before
(never after) the registry admits a same-key workflow. `commitGuardedKill` on an already boundary-terminal
durable row (`completed`, `blocked`, `failed`) is a no-op while abort still
stops the graph — including `kill` on a **completed** sibling step id while a
later step is still tracked and in flight. The named non-terminal step becomes
durable `killed`; terminal siblings stay unchanged; the workflow entry row
rolls up to `killed` after settlement (not workflow `failed` from abort unwind
alone). Non-live workflow rows (no matching `activeRuns` entry) reject `kill`
with `run_not_active`.

`pause` and `resume` reject workflow-started rows with `run_not_active` (same
code as an absent or non-active run); only ad-hoc `write-loop` rows carry
`pauseController` / write-loop `resume` plumbing.

### Daemon retirement on supersession

When a newer daemon starts, it broadcasts a `supersede` RPC to every
other daemon socket discovered in `~/.jarvis`, best-effort and non-blocking.
A superseded daemon flips to a retiring state: subsequent `start` and `resume`
calls are rejected with code `daemon_superseded` before any claim, run row,
or worktree materialization. Runs already admitted by the retiring daemon —
including those in-flight — continue executing under that daemon and reach
their normal outcomes (paused, killed, completed, failed, blocked) without
interference. The retiring daemon does not promote queued runs.

Once the retiring daemon's active-run set is idle (empty), the daemon exits
automatically. A retiring daemon with no active runs exits immediately and
without operator action. Live observation methods (`health`, `status`, `list`,
`wait`, log tail, `pause`, `kill`) remain available while the daemon is
retiring and finishing its active work; callers may continue steering
in-flight runs until they settle.

Worktree locks, agent child processes, and log sinks stay with the admitting
daemon that spawned them; a superseded daemon releases its own work only.

### Admission guards for `start` and `resume`

There is no global single in-flight guard — multiple runs may be active
concurrently across different `(project, branch)` keys.

1. **Existing queued run for the key (`start` only):** Rejected with
   `code: "worktree_claimed"` when an existing durable `queued` run already
   holds the `(project, branch)` key — never queue a second entry behind it.

2. **Memory watermark (`start` only):** `start` then checks
   `hasMemoryHeadroom()` (see [Memory watermark](#memory-watermark)). Not
   clearing the floor persists the run durably with status `queued` (its
   `WriteLoopInput` saved for later promotion) and returns `{ runId }`
   without spawning, even if the key is currently held by a live run —
   promotion's skip-and-continue logic (see
   [Promotion of queued runs](#promotion-of-queued-runs)) resolves that
   conflict once memory clears. `start` never blocks waiting for memory to
   free.

3. **Per-`(project, branch)` key (live claim):** Once memory clears the
   floor, `start` is rejected with `code: "worktree_claimed"` when the key is
   held by a live run — the same guard applies to `resume`,
   which has no memory check and spawns immediately once its key check
   passes. Both call a single exported `checkWorktreeClaimed` function
   against the `WorktreeOwnershipRegistry`, so the check and its error shape
   can't drift between them.

4. **Workflow starts (`start` with `{ steps }`):** the same two guards
   (queued-run check, then live-claim check) run first, against a key
   derived from the workflow's first step — `worktree.projectName`/
   `worktree.branchName` when that step's `behavior` is `"write"`, else its
   flat `project`/`branch` fields (`"review"` or `"review-debate"`). A workflow
   claim records its daemon-live owner from acquisition through cleanup. If its
   owner is no longer live in daemon memory, admission releases only that stale
   claim and acquires the key for the new workflow; a live owner still rejects
   `worktree_claimed`. This never changes worktrees or branches on disk.

## Streaming

Streams multiplex on the same connection via `stream-open` / `stream-data` /
`stream-end`. The `stream-open` payload carries `{ runId: string, afterSeq?: number, follow?: boolean }`
to identify the run and optionally resume from a prior log position. The `afterSeq` field specifies
a cursor: the server emits only persisted records with `seq > afterSeq`, then streams new appends.
Absent, non-numeric, or negative `afterSeq` resolves to `0` (full replay). Follow subscribe uses
`max(last replayed seq, afterSeq)` to dedupe appends past the replay.

`follow` defaults to `false`: after replay, the server closes the stream with `stream-end`
regardless of the run's status — this is snapshot mode, and completion is the server closing after
replay, independent of the run settling. When `follow: true` and the run is `in-progress`, the
server instead streams new appends as `stream-data` frames — one record per frame — until the
client closes with `stream-end` or the connection drops; that continued-tail completion is separate
from snapshot mode's replay-then-close. Each record is a `PersistedRecord` serialized as JSON in the
`payload` field.

In follow mode the server also re-reads the run's status from the state store: once immediately
after replay (before entering the follow loop), then again after each record `follow()` yields, and
independently on a fixed timer (`FOLLOW_POLL_MS`, configurable via `followStatusPollMs` for tests) so
an empty poll tick — no new record — still triggers a re-read. This matters because a run can go
terminal without appending a further record (e.g. a kill), which would otherwise leave a
record-triggered-only re-read blocked forever. Once status is terminal (`isTerminalRunStatus`), the
server stops consuming `follow()` and closes the stream with `stream-end` on its own — an operator
following a run to completion no longer needs Ctrl-C or a separate `run wait`/`run list` to notice it
settled. Before closing, the server re-reads `tail()` once more and emits any record beyond the last
one delivered, so a record appended at or after the status flip (e.g. `workflow-runner.ts` commits
`runStatus: "completed"` before appending `loop_finished`) is drained, not dropped.

RPC traffic on the same connection keeps `id` correlation while a stream is
open.

## Daemon lifecycle API

The daemon is a detached child process. Callers interact via three programmatic
functions in `v2/src/daemon/daemon-lifecycle.ts`.

### `startDaemon(socketPath, options?)`

Spawns a detached child running `v2/src/daemon/daemon.ts`. Returns metadata `{pid,
socketPath}` or throws on startup failure.

**Injected paths:** Callers must supply an explicit `socketPath`; the daemon
environment variable is `DAEMON_SOCKET_PATH`. Tests may inject `pidPath` (for
cleanup); `daemonScript` (test override); `readinessTimeoutMs` (default 5s);
`logPath` (process-level stdio capture); and `logCapBytes` (rotation cap,
default 5 MiB).

**Log path:** When `logPath` is provided, child stdout and stderr are opened
in append mode before spawn and inherited by the child. Missing or unwritable
log directory throws before spawn. Caller closes its fd copy after spawn.
When `logPath` is omitted, stdio remains discarded (existing behavior).

**Log rotation:** At spawn time, if the existing log file is at or over
`logCapBytes`, it is rotated to `<logPath>.1`, replacing any prior `.1`.
Rotation is checked once at spawn; a long-lived daemon may exceed the cap,
and the bound holds across restarts.

**Process-log boundary:** `<logPath>` carries process-level output (uncaught
exceptions, spawn failures, stray harness stderr). Run and agent output flows
through the persisted log store and log-server stream path, not `<logPath>`.
Concurrent daemons sharing one `logPath` are unsupported; double-start
protection covers the real case.

**CLI default:** The CLI pins `~/.jarvis/daemon.log` alongside `daemon.sock`
and `daemon.pid`; other callers supply `logPath` explicitly or omit it to
discard.

**Double-start protection:** If the socket already responds to `health`, throws
`DaemonAlreadyRunningError` (no second child spawned).

**Readiness:** Polls the socket for `health` response. Throws
`DaemonReadinessTimeoutError` if the child is alive but socket doesn't respond
within `readinessTimeoutMs`.

### `stopDaemon(socketPath, options?)`

Normal shutdown first reads the durable run store. `in-progress`, `paused`,
`budget-soft-stopped`, and `queued` rows refuse
the stop and report every run ID. The refusal happens before shutdown, process
signals, or PID cleanup. A store read failure also refuses the stop.

`completed`, `failed`, `blocked`, and `killed` rows do not block. With
`force: true`, the durable guard is skipped and the existing graceful shutdown
path is used: RPC `shutdown`, SIGTERM, bounded wait, SIGKILL if needed, and
`pidPath` cleanup.

**Drain:** Signals server to reject new connections and drain in-flight IPC
(default 2s). Waits bounded time (default 3s) for process exit after SIGTERM.

**Process-only fallback:** If socket is unreachable, signals the process
directly. If `pidPath` is not provided, external signal handling is required.

### `getDaemonStatus(pid, socketPath, options?)`

Returns `"running"` only if process is alive AND socket responds to `health` in
short timeout (default 1s). Returns `"stopped"` on any liveness or transport
failure.

**Probe order:** Process liveness first (no socket I/O if dead). Prevents false
"running" states from stale sockets.

### `jarvis daemon log [--follow]`

Reads `<logPath>` (the process-level log from `startDaemon`'s
[Log path](#startdaemonsocketpath-options) above) directly off disk — no PID,
socket, or IPC-status check, so it works whether or not the daemon is
running. Operator-facing CLI contract:
[`write-behavior.md` § Daemon CLI](./write-behavior.md#daemon-cli).

Implementation: `v2/src/daemon/daemon-process-log.ts`
(`readDaemonProcessLog` / `followDaemonProcessLog`). `--follow` replays
retained bytes then polls (`FOLLOW_POLL_MS`, 200ms — separate from the 250ms
poll interval in
[`log-stream.ts`](../src/persistence/log-stream.ts)'s structured-log follow)
for appends, tracking file identity by inode: a shrink or inode change resumes
from the current file at the configured path; a missing path reports on
stderr and stops with a nonzero exit.

## In-memory worktree ownership

The daemon holds a registry keyed by `{ project: string, branch: string }`.
Each entry records `{ runId, worktreePath }`.

**Registry methods:**
- `claim(key, ownership)` — acquires ownership; throws `DaemonDoubleClaimError`
  on double-claim (no overwrite).
- `release(key)` — releases ownership; no-op if key not held.
- `get(key)` — returns ownership or undefined.
- `isClaimed(key)` — boolean test.

**No disk writes:** Registry is in-memory only. Cross-process coordination uses
`.jarvis.lock` and git worktrees locking (unchanged).

Workflow settlement releases both ownership layers before terminal observation:
the invocation and finalization repair first quiesce, then the managed-worktree
owner releases `.jarvis.lock`. For `completed` and `failed`, the daemon workflow
`finally` then releases the registry claim before exposing the durable status.
For `killed`, `commitGuardedKill` durably persists `killed` first, and only then
does the daemon workflow `finally` release the registry claim — so a same-key
start is never admitted before `killed` is durable. This includes daemon kill
during repair. A same-key implement start is therefore admissible immediately
after terminal observation, without joining deferred workflow work.

## Spawn-boundary failure capture

When the factory's background `writeLoopExecutor` rejects (harness fault outside
normal `loop_finished` settlement), capture runs in the spawn IIFE after the RPC
returns — `start` and `resume` share this path:

1. If durable status is not already terminal (`completed`, `blocked`, `killed`,
   `paused`, `failed`), best-effort `setRunStatus("failed")`. Persist errors do
   not block cleanup.
2. Await the injected `failureReporter(runId, reason)` with the original
   rejection value (production: open log sink via `logsPath`, append one
   `run_execution_failed` event, close sink).
3. Release in-memory worktree ownership and active-run entries (`finally`).

Does not call `commitCompletionBoundary`; latest attempt may stay `in-progress`.
Does not rethrow to RPC callers or emit daemon stderr — diagnostics flow through
the reporter contract only.

**Dual-outage (out of scope):** When both `stateStore` and the log reporter are
unreachable on failure, no orphan repair is attempted.

**Post-failure operator shape:** `list` reports `status: "failed"`, `isLive:
false`; a new `start` for the same `(project, branch)` is accepted once capture
settles.

### Workflow async-path failure capture

When `executeWorkflow` rejects after step 0's run row exists (harness fault
outside normal per-step `loop_finished` settlement), `startWorkflowRun` settles
every non-terminal run id tracked for the workflow:

1. If durable status is not already terminal (`completed`, `blocked`, `killed`,
   `paused`, `failed`), best-effort `setRunStatus("failed")`. Persist errors do
   not block the append.
2. Append one `run_execution_failed` event with `message` through the workflow's
   open log sink (`logSink.append(runId, { kind: "run_execution_failed", message
   })`). Append errors do not roll back the demote. Skipped when `logsPath` is
   unset (`logSink === undefined`).
3. Release workflow worktree ownership, active-run entries, and close the sink
   (`finally`).

Ordering is fixed per run id: demote → append → `finally`. `wait` wakes on the
terminal log record and then reads durable status, so the status commit must
land before the append.

`paused` and `killed` rows are left as-is with no terminal record — resumability
and kill semantics outrank failure reporting. A rejection before step 0's run row
exists still resolves the `start` RPC with `invalid_params` instead of settling
background runs.

Does not use `failureReporter` (spawn-boundary reporter is message-less). Does not
call `commitCompletionBoundary`; latest attempt may stay `in-progress`. Does not
rethrow to RPC callers once step 0 has resolved.

**Post-failure operator shape:** non-terminal workflow runs report `status:
"failed"`, `isLive: false`, and `wait`/`list` surface `harness_failure` from the
terminal `run_execution_failed` record; worktree ownership is released so a new
`start` on the same `(project, branch)` is accepted once settlement finishes.

## Memory watermark

`memory.minFreeGb` in the active machine profile (`config/machines/<profile>.json`,
same file as the `models` key) sets a free-memory floor in GB. Unset (or
`memory` key absent) means no gating. When present, `minFreeGb` must be a
positive finite number — `0`, negative, or non-numeric values throw at
profile load, matching `models` validation.

`hasMemoryHeadroom(profileName: string, freeMemReader?)` in
`v2/src/daemon/memory-watermark.ts` reports whether current free memory
clears the configured floor: `true` when unconfigured, else compares an
injectable free-memory reader (default `os.freemem`) against the floor
converted to bytes. Wired into `start` admission (see
[Admission guards](#admission-guards-for-start-and-resume)).

`createRunControlHandlers`'s default `hasMemoryHeadroom`/`settleDelayMs` deps
resolve `profileName` via `resolveMachineProfile()`
([`machine-config-loader.ts`](../src/config/machine-config-loader.ts)), which
reads the required `machineProfile` key from `~/.jarvis/config.json` — not a
hardcoded profile name. A missing or empty `machineProfile` hard-fails `start`.

### Promotion of queued runs

Promotion logic is `promoteQueuedRunImpl`, a standalone function in
`v2/src/daemon/daemon.ts` (deps: state store, `WorktreeOwnershipRegistry`,
memory-headroom check, settle-delay duration/state, `spawnWriteLoop`
callback) — unit-testable without an IPC socket. `createRunControlHandlers`
binds it once (`promoteQueuedRun`) and calls that binding from two trigger
points, not a poll timer: after `start` admits or queues a run, and inside
`spawnWriteLoop`'s `finally` block — the single place that releases a run's
`activeRuns` entry and registry claim on every exit path, including a run
reaching `paused`.

Each trigger considers `queued` runs oldest (`created_at`) first, skipping
any whose `(project, branch)` key is currently claimed in favor of the
next-oldest eligible one, and promotes at most one run per call: sets its
status to `in-progress`, then spawns it from its persisted `WriteLoopInput`.
Workflow-step queued inputs pass persisted `bindingResolution` context
(`role`/`agents`/historical `agentModelConfig`) through `resolveWriteLoopBindings`,
which loads rungs from the current machine profile; ad-hoc inputs keep bare
agent-id binding rehydration until they gain resolver context.
No preemption — promotion only fills free headroom; it never pauses, kills,
or otherwise touches an already-running run.

**Settle delay:** after a promotion, further promotions are suppressed for
`memory.settleDelayMs` (profile config, default `DEFAULT_SETTLE_DELAY_MS` in
`v2/src/config/machine-profile-loader.ts`) before headroom is re-measured, to
avoid racing ahead of the just-admitted run's memory footprint ramping up.
One exception: `start` performs a one-time immediate
recheck (bypassing the settle delay) on the row it just queued, covering the
case where memory has already recovered by the time the row is persisted —
without it, a queued run with no other run active has no further promotion
trigger until the next `start`/exit event.

## Invocation session logs

Each write-loop iteration opens an on-disk transcript at
`~/.jarvis/sessions/<run-id>-<timestamp>.log` (default sessions dir; timestamp
is millisecond-granularity ISO with `:` replaced for filesystem safety). One file
per iteration — not one per run and not one per binding attempt in the fallback
chain.

Lines mirror v1: `<ISO ts> [<tag>] <text>` with tags `harness`, `outbound`,
`inbound_stdout`, `inbound_stderr`. Before the agent subprocess spawns, the loop
writes a `harness` line naming run id, spec path, and iteration number; the
invocation layer appends binding `harness`/`outbound` and post-settle `inbound_*`
into the same file. When the iteration settles (including timeout, abort, and
thrown-error paths), the loop appends a final `harness` line
(`outcome=completed|timeout|abort|error`) and closes the file.

These files are orthogonal to the structured log stream (`jarvis run log`,
persisted under the daemon logs path): session logs are the first artifact when
a run hangs before `iteration_started`/`boundary_committed` rows accrue; the
structured stream is the durable run timeline once records exist. See
[`invocation-liveness.md`](./invocation-liveness.md) and
[`first-workflow-walkthrough.md`](./first-workflow-walkthrough.md).

## Pipeline stage resolution

`pipeline_stages` rows are keyed by `(stageId, branchKey)`; admission and `createPipelineStageBranch` persist branch rows. Persisted stage artifacts may include `downstreamInputs: string[]` of worktree-relative ready-intent file paths; multi-file intent completion records those paths on the stage artifact. The first chained stage after a splitting intent fans out one preset binding per `downstreamInputs` entry (`resolveStageWorkflowSteps` returns `{ ok: true; results }` with one element per path when length ≥ 2); later chained stages resolve from the branch-local preceding artifact and return a single `{ ok: true; steps }`; single-file handoff (file `specPath`, no `downstreamInputs`) is unchanged. See [Branch fan-out execution](#branch-fan-out-execution) for daemon dispatch and settlement.

`v2/src/daemon/pipeline-stage-resolve.ts` turns one `pipeline_stages` row plus
pipeline-level context into a `WORKFLOW_PRESET_BUILDERS` call. Admission holds a
`PipelineContext` in daemon memory for the pipeline loop's lifetime (not
persisted): `{ cwd, configPath?, targetDir?, projectRegistry?, seed }`.

Posture → preset (`validatePipelineDefinition` in
`v2/src/execution/pipeline-definition.ts` is the sole admission authority on
which `(workflow, review)` pairs are realizable; this table only maps realizable
pairs to builders and is never consulted for validity):

| workflow    | review   | preset                |
| ----------- | -------- | --------------------- |
| `intent`    | `none`   | `intent`              |
| `intent`    | `light`  | `intent-reviewed`     |
| `intent`    | `debate` | `intent` (`reviewPasses: 1`, `reviewBehavior: "debate"`) |
| `plan`      | `none`   | `plan`                |
| `plan`      | `light`  | `plan-reviewed-light` |
| `plan`      | `debate` | `plan-reviewed`       |
| `implement` | `light` or `debate` | the implement builder, with `reviewBehavior` set to the stage's own posture — never the project's configured implement review default |

At admission, only `implement` + `none` is unrealizable
(`unrealizable-review-posture`); `intent` + `debate` and every other table row
is realizable. `implement` has no unreviewed builder path (same rule as
[`workflow-runner.md`](./workflow-runner.md) pipeline posture matrix).

Seed/artifact hand-off: the first workflow stage (by authored position) builds
with admitted `PipelineContext.seedPath` as file `seed` or inline
`PipelineContext.seed` as `seedText` (never both; `seedPath` wins when both are
stored) and `PipelineContext.cwd` as its read root. Every later workflow stage
builds from the immediately preceding
workflow stage's recorded artifact (approval stages are skipped when walking
back to find it): resolution loads the prior stage's entry run via
`store.loadRun(artifact.entryRunId)` and sets preset `cwd` to that run's
`worktreePath`. Artifact `specPath` is worktree-relative: `readyIntent` for
`plan`/`plan-reviewed*` presets; chained implement normalizes directory
`specPath` to `<dir>/index.md` in `resolveImplementStage` (see
[operator-runbook § Pipeline start](./operator-runbook.md#pipeline-start)).
Never joined to admission `cwd` and never absolutized
in the store. When the preceding artifact carries
`downstreamInputs` with length ≥ 2, the first chained stage after that
splitting artifact resolves one preset per listed file path (each bound as
`readyIntent`); length 1 binds that path only; absent `downstreamInputs` keeps
file `specPath` single-resolution. A listed path missing from the prior
worktree fails without falling back to directory `specPath`. Later chained
stages (e.g. implement after per-branch plan) resolve from the branch-local
preceding artifact only and do not re-iterate intent `downstreamInputs`.
Chained implement resolution takes its
`baseRef` from the prior entry run's `branch` and checks spec availability
against that run's `worktreePath`, not admission `cwd` and not the default
branch. The `fast` integration case is the inter-stage worktree handoff
proof: it seeds every stage artifact on real stage worktrees and asserts the
ready-intent and plan spec tree are absent from the operator checkout.

`reviewPasses` and `reviewBehavior` on built intent/plan/implement inputs are
derived from the stage's own `review` posture (`none` → `reviewPasses: 0` with
no review behavior; `light`/`debate` → one pass with an explicit matching
behavior). Preset names alone do not suppress review — `intent` and
`intent-reviewed` share a builder; only `reviewPasses: 0` omits review steps.

`PipelineContext.projectRegistry` is passed through to the implement builder
only; intent/plan resolution uses `configPath` (and optional `targetDir`) for
project and target-dir lookup, matching the CLI's config-backed registry.

Resolution failure: a stage whose `(workflow, review)` pair has no table
entry, or whose builder call itself reports `{ ok: false }`, returns
`{ ok: false; error: string }` — never a thrown error and never a fallback to
a different preset.

## Pipeline stage dispatch

`v2/src/daemon/pipeline-stage-dispatch.ts`'s `dispatchPipelineStage` takes one
resolved stage's steps, a `PipelineWorkflowDispatch` callback, a
`PipelineWorkflowWait` callback, and the `StateStore`, and drives one stage
through to its terminal outcome. The daemon builds both callbacks as thin
closures over its own private `handleWorkflowStart`/`startWorkflowRun`
machinery and the mechanism backing the `wait` RPC handler — a standalone
module cannot reach either directly.

- `PipelineWorkflowDispatch = (steps) => Promise<{ ok: true; entryRunId; invocationId } | { ok: false; code; message }>`.
  A refusal (claimed worktree, insufficient memory, materialization failure,
  routing-read failure, invalid params) records `endedAt`, `status: "failed"`,
  and `failureDetail: { code, message }` immediately — no `startedAt`, no
  `workflowInvocationId`, no retry or queueing.
- On a successful dispatch, `workflowInvocationId` (set to the returned
  `entryRunId`) and `startedAt` are written via `StateStore.updateStage`
  *before* the invocation settles, so a crash mid-stage leaves a resolvable
  linkage.
- The dispatcher then awaits settlement through `PipelineWorkflowWait`, not
  the dispatch callback's own promise (which resolves at run creation, before
  the workflow's steps have run). This mirrors the daemon's own `wait` RPC
  handler, which awaits the in-flight workflow promise and then reads
  `rollupWorkflowRunStatus` for the entry run.
- Terminal success is `rollupWorkflowRunStatus` reporting `completed`: records
  `status: "succeeded"`, `endedAt`, and an artifact reference
  `{ entryRunId, invocationId?, specPath, prNumber?, prUrl? }` (plus `prNumber`/`prUrl` when
  present), all read off the entry run row (`StateStore.loadRun`); `specPath`
  is worktree-relative, matching `pipeline-stage-resolve.ts`'s convention. A
  missing entry run or missing `specPath` at success time records `failed`, not
  `succeeded` with an empty path.
- Any other rollup status (`failed`, `blocked`, `killed`, `interrupted`,
  `paused`, or anything else the wait primitive returns) records `status:
  "failed"`, `endedAt`, and a `failureDetail` — never an artifact reference and
  never a stage left at `running` while later stages are marked `skipped`. When
  the entry run row is present, `failureDetail` is built from
  `composeRunOperatorError` (`run-operator-error.ts`); when it is absent, a
  hand-built `{ reason, retryable, nextAction }` harness-failure shape is used.
- An unexpected throw or rejection anywhere in dispatch/settlement records the
  same `failed` row with `{ message }` via a best-effort store write.

Stage status vocabulary (daemon-owned, not interpreted by the state store):
`pending` (admitted, undispatched), `running` (dispatched, unsettled),
`succeeded`, `failed`, `skipped` (never dispatched because an earlier stage
failed — written by the progression loop, not this module).

## Ordered pipeline progression

`pipeline_start` (`handlePipelineStart` in `daemon.ts`, registered in
`createRunControlHandlers`'s handler map alongside `start`/`list`) admits a
`PipelineDefinition` plus a `PipelineContext` on the caller's word — the
handler does not re-run `validatePipelineDefinition`; callers must validate
before RPC. It calls `StateStore.createPipeline` with the supplied `context`
so the immutable admission snapshot is written in the same transaction as the
definition and stage rows, starts the ordered loop
(`v2/src/daemon/pipeline-execution.ts`'s `runPipeline`), and returns
`{ pipelineId }` only after that admission transaction succeeds — mirroring
`startWorkflowRun`'s "resolve at row creation, keep running after" shape. The loop is not awaited by the handler and does not hold the client
connection open; the client disconnecting right after receiving `pipelineId`
is what proves daemon (not client) ownership. Exactly one loop instance runs
per pipeline, started once from `handlePipelineStart`.

Between two pipeline stages the daemon may have no workflow rows in
`activeRuns` (`hasActiveRuns()` is false in the gap after one stage settles and
before the next dispatches). That window is normal for same-session retirement:
a superseding daemon can exit once `hasActiveRuns()` clears even though the
pipeline loop will dispatch the next stage moments later on the admitting daemon.

**Deferred vs CLI workflow launch:** `jarvis run workflow …` runs
`prepareWorkflowSteps` (iteration bounds, configured idle-output and review-role
timeouts on review steps) and `maybeResetStaleWorkspace` for `plan`/`implement`
before `start { steps }`. Pipeline stage resolution dispatches raw preset-builder
output without that post-processing or stale-worktree reset in this slice.

`runPipeline` walks `loadPipeline(pipelineId).stages` in authored position
order. For each workflow stage it re-reads the stage's own row before acting
(not just its loop position), so an already-`running`/settled stage is never
re-dispatched — a defensive guard, since the daemon only ever starts one loop
per `pipeline_start` call. It then resolves the stage
(`pipeline-stage-resolve.ts`) and dispatches it (`pipeline-stage-dispatch.ts`).
An approval stage records or honors its durable status before returning: a
`pending` row transitions to `awaiting` via `commitApprovalBoundary` under its
stable `PipelineStageRecord.id`; `awaiting` blocks progression; `approved`
permits the eligible next stage; `rejected` settles the pipeline without later
dispatch. Every later undispatched stage stays `pending`. If the boundary write
refuses, execution reloads only the addressed row and applies its authoritative
`awaiting`/`approved`/`rejected` meaning; any other status settles the
pipeline `failed` on that row without dispatching the suffix. See
[`state-store.md`](./state-store.md) for conditional approval operations. A
stage that settles `failed` — a resolution failure or a dispatch/settlement
failure per `pipeline-stage-dispatch.ts` (including a start-time dispatch
refusal) — settles the pipeline `failed` by writing `status: "skipped"` to
every later stage via `updateStage` and dispatching none of them; there is no
best-effort continuation past a failure.

Ownership-key contention: a stage whose steps target a `(project, branch)`
already claimed by another in-flight workflow or pipeline is refused at
dispatch time through the daemon's existing single-claim
`WorktreeOwnershipRegistry` — the same refusal path as `workflow.start` —
recorded as that stage's failure. This slice adds no pipeline-level queueing
beyond the existing registry; two pipelines targeting the same project
concurrently is out of scope. Observability: pipeline stage runs are not yet
attributable to their owning pipeline in `workflow.list`/CLI run listings —
deferred. RPC pipeline inspection is available through `pipeline_list`; CLI
pipeline inspection remains unavailable. Internal repository reads
`loadPipeline` and `listPipelines` can inspect persisted pipeline and stage
state; [`state-store.md`](./state-store.md) is their single contract home.

### Branch fan-out execution

When a splitting intent stage succeeds with `downstreamInputs` length ≥ 2,
`runPipeline` admits one pending branch row per downstream ready-intent file
for every authored stage after the splitting stage. `branchKey` is the ready-intent
file basename without `.md`. Pre-admitted `default` rows for those downstream
stages are reconciled to `skipped` so they never dispatch. The first chained
workflow stage after the split resolves fan-out (`{ ok: true; results }`) and
dispatches each result to its matching `branchKey`; later workflow stages on a
branch resolve from branch-local preceding artifacts only. `skipRemainingStages`
applies within one `branchKey` — one branch failure does not skip sibling
branches. `pipeline_approve` / `pipeline_reject` accept optional `branchKey`
and refuse with `branch_key_required` when multiple branch rows exist and it is
omitted. `derivePipelineState` aggregates across fan-out branches; terminal
`succeeded` requires every branch to succeed. `derivePipelineFailureDetail` names
failed or rejected `branchKey`s when aggregate state is non-`succeeded` at
derivation time. `pipeline_list` and `pipeline_wait` project `branchKey` on
every durable stage row and name `awaiting-approval` boundaries with the
blocking gate's `branchKey`. Multi-branch terminal publication when every
implement branch succeeds is unchanged / deferred. Slug:
`pipeline-intent-split-fan-out-execution`.

### Restart-safe pipeline continuation

On daemon startup, after run orphan reconciliation and before pipeline orphan
reconciliation, `continueContinuablePipelines` walks every `active` or reconciled-
`interrupted` pipeline whose derived state is `pending`, whose `context` snapshot
is present, and whose recorded owner is dead or `NULL`. For each candidate it
calls `continuePipeline` (`pipeline-execution.ts`): load the persisted admission
context from the durable pipeline row (never caller-supplied reconstruction),
atomically claim one live owner through `StateStore.claimPipelineContinuation`
(`priorOwnerIdentity` must match the row; first writer wins; restores
`status = 'active'`), then resume the ordered `runPipeline` loop. Predecessor
workflow artifacts are read from succeeded stage rows during that walk — the
same carry-forward path as a same-session loop.

A losing or duplicate claim is refused with no stage-row mutation and no
dispatch. Continuation does not activate `awaiting-approval` or `rejected`
pipelines (those require an explicit approval decision first, or are terminal).
A `failed` pipeline is not activated until `reopenFailedPipeline` has been
applied in place — activation then resumes at the reopened continuation row
without re-dispatching succeeded predecessors. Pipelines that remain unclaimed
after this pass are settled `interrupted` by `reconcilePipelines` as before;
eligible pipelines reconciled in an earlier daemon incarnation become activatable
again when `claimPipelineContinuation` restores `active` ownership.

`isPipelineContinuable` returns true when `isPipelineSettlementPending` is true
(every authored stage satisfied but terminal publication has not succeeded) regardless
of derived `pending`, so restart can finish never-attempted settlement. Otherwise it
composes `derivePipelineState`, `approvalOutcomePermitsActivation` (no `awaiting`/`rejected`
approval rows), and `reopenedFailurePermitsActivation` (no remaining `failed` rows).
Approved gates with a pending workflow successor and reopened failed continuations both
satisfy these guards when derived state is `pending`.

### Pipeline approval decisions

`pipeline_approve` and `pipeline_reject` (`handlePipelineApprovalDecisionHandler`
in `daemon.ts`) target one authored `stageId` under a `pipelineId`, optionally
scoped by `branchKey` when multiple branch rows exist. The handler resolves that
`stageId` (and `branchKey` when supplied) to a single durable stage row, then
admits the decision through `StateStore.commitApprovalDecision` on the row's
stable `PipelineStageRecord.id` — never by pipeline ID alone. When multiple
non-`skipped` branch rows exist at the stage and `branchKey` is omitted, the
handler refuses with `branch_key_required`. Missing or empty `pipelineId`/`stageId`
→ `invalid_params`. A retiring (superseded) daemon rejects both methods with
`daemon_superseded`, matching other mutating pipeline RPC retirement.

On an applied `pipeline_approve`, the handler returns the applied outcome and
detaches; `continuePipeline` runs asynchronously from the persisted admission
context (no caller-supplied reconstruction). On an applied `pipeline_reject`, the
handler returns after the durable write and never dispatches later stages. The
first atomically admitted matching decision wins; duplicate or racing decisions
return the store's named refusal (`status_not_awaiting`, etc.) with no additional
dispatch and no mutation of other stage rows. Refused targets (`pipeline_not_found`,
`stage_not_found`, `not_approval_stage`, non-`awaiting` rows, invalid decisions)
propagate the store reason without fail-open progression.

`applyPipelineApprovalDecision` in `pipeline-execution.ts` admits through
`commitPipelineApprovalDecision` and detaches `continuePipeline` on applied approve,
passing the approved `branchKey` when supplied so post-approve suffix selection runs
only that branch until the next approval gate. Recovery paths (`recoverContinuablePipelines`,
`resumePipeline`) call `continuePipeline` without a `branchKey` and may walk every
actionable fan-out branch.

### Pipeline stage-scoped resume

`pipeline_resume` (`handlePipelineResumeHandler` in `daemon.ts`) is the sole
daemon-owned stage-scoped resume entry point. It composes `derivePipelineState`,
`reopenFailedPipeline`, `claimPipelineContinuation`, and `continuePipeline` in
`pipeline-execution.ts` — never translating resume into `pipeline_start` or
run-level `resume`.

Missing or empty `pipelineId` → `invalid_params`. A retiring (superseded)
daemon rejects with `daemon_superseded`, matching other mutating pipeline RPC
retirement.

On derived `failed`, the handler applies `reopenFailedPipeline` when a `failed`
row remains, returns the admission outcome, and detaches `continuePipeline` from
persisted admission context when reopen applies. Already-reopened failures
(`reopenedFailurePermitsActivation` true, derived `pending`) skip reopen and
continue only the eligible failed stage; every predecessor `workflowInvocationId`
and artifact stays unchanged.

On derived `awaiting-approval`, the handler may claim ownership via
`claimPipelineContinuation` but must not call `continuePipeline`. The gate row
stays `awaiting` with no later dispatch. Missing persisted admission context →
`missing_context`; `claimPipelineContinuation` refusal → `claim_refused`.
`isPipelineContinuable` remains false for awaiting pipelines, and startup
`recoverContinuablePipelines` does not auto-activate them — awaiting resume is
explicit-only.

Terminal refusal without dispatch: derived `succeeded` →
`pipeline_terminal_succeeded`; derived `rejected` → `pipeline_terminal_rejected`.
Deferred-state refusal without dispatch: derived `running`, fresh `pending`, or
`interrupted` → `pipeline_not_resumable`. When `reopenFailedPipeline` refuses
an ineligible failed shape, the store reason propagates unchanged (`no_failed_stage`,
`multiple_failed_stages`, `malformed_continuation`, `reopen_lost`, etc.).

The handler resolves after reopen and/or claim admission (or refusal), not after
detached continuation finishes.

### Pipeline snapshots

`pipeline_list` (parameterless) returns one durable enumeration of every
admitted pipeline without following live transitions:

```json
{ "pipelines": [{ "pipelineId", "name", "state", "terminalAction?", "seedPath?", "terminalPublicationSucceededAt", "terminalPublicationFailure", "createdAt", "finishedAtMs", "stages": [{ "id", "stageId", "branchKey", "position", "status", "workflowInvocationId", "startedAt", "endedAt", "artifact", "failureDetail" }] }] }
```

`terminalAction` comes from the admitted definition. `seedPath` is copied
unchanged from durable admission context, may remain relative to admission
`cwd`, and does not expose `cwd`. Each is omitted when absent. The nullable
`terminalPublicationSucceededAt` and `terminalPublicationFailure` fields are
always present and mutually exclusive. Stage `artifact` and `failureDetail`
preserve stored JSON exactly, including `null`, `false`, `0`, and `""`.

`createdAt` is the durable pipeline row admission timestamp (ms). `finishedAtMs`
is `null` while derived `state` is non-terminal; for terminal states it is
`terminalPublicationSucceededAt` when set, otherwise the maximum non-null stage
`endedAt`, otherwise `createdAt`. Stage `startedAt` and `endedAt` are
milliseconds since epoch; each is `null` when unset on the durable row.

An empty store returns `{ "pipelines": [] }`. Stage snapshots preserve stored
authored-position order and expose that durable `position` plus row `id` (then
`branch_key` within each position); pipeline order is unspecified. The response promises
no stronger cross-pipeline or concurrent-row isolation than that single
`listPipelines` read — observation does not hold execution writes.

`pipeline-execution.ts`'s `derivePipelineState` computes each `state` from
durable pipeline and stage rows only (no new column), walking stages in stored
`position` order — the same ordering `runPipeline` and `loadPipeline` use.
First match wins:

1. `interrupted` — any stage row reads `interrupted` (pipeline-level
   `interrupted` alone is a reconciliation marker and does not mask preserved
   stage evidence).
2. `rejected` — any approval stage row reads `rejected`.
3. `failed` — any workflow stage row reads `failed`, or any approval stage row
   reads `failed` (for example a refused boundary write with an unexpected
   status).
4. `running` — any workflow stage row reads `running`.
5. `awaiting-approval` — authored-position walk reaches the first unsatisfied
   stage (`isAuthoredStageSatisfied`) and it is an approval stage (`pending` or
   `awaiting`).
6. `pending` — the walk reaches the first unsatisfied workflow stage (including
   undispatched rows).
7. `running` — `terminalAction` is set, every authored stage is satisfied, and
   `terminal_publication_succeeded_at` is unset with no durable
   `terminal_publication_failure` (settling interval while
   `executeTerminalPublication` runs or awaits restart continuation).
8. `failed` — durable `terminal_publication_failure` is present (stage rows may
   still read all `succeeded`).
9. `succeeded` — every authored stage is satisfied and either no `terminalAction`
   is configured or terminal publication succeeded (`terminal_publication_succeeded_at`
   set).

Stage satisfaction for the walk: workflow stages satisfy on `succeeded`;
approval stages satisfy on `approved`. Any unsatisfied approval row (for example
`awaiting` or `pending`) is undecided; `rejected` is handled at step 2. `skipped` rows
are never satisfied and are never reached because `failed` always precedes
them. After reconcile, operators see `awaiting-approval`, `pending`, or
`rejected` from untouched stage rows even while the pipeline row still reads
`interrupted`; `claimPipelineContinuation` restores `active` when continuation
claims ownership.

Terminal states: `succeeded`, `failed`, `rejected`, `interrupted`.
Non-terminal: `pending`, `running`, `awaiting-approval`. Callers must not
infer terminality from raw stage vocabulary alone.

After the ordered stage walk completes with every authored stage satisfied and
no early `stop`, `runPipeline` invokes `executeTerminalPublication` when the
admitted definition carries `terminalAction`. Executor input resolves from the
authored-order last succeeded workflow stage artifact (`prNumber`, `prUrl` from
the stage artifact; `worktreePath`, `branch`, `baseRef` from
`store.loadRun(artifact.entryRunId)`). Success stamps
`terminal_publication_succeeded_at`; failure records `terminal_publication_failure`
without rewriting stage rows. `continuePipeline` and `recoverContinuablePipelines`
idempotently finish pending settlement when stages are satisfied but the success
marker is absent. Terminal-publication failure is non-resumable via
`pipeline_resume` / `reopenFailedPipeline` in this slice.

### Pipeline wait

`pipeline_wait { pipelineId }` blocks until the named pipeline reaches a
wait boundary, or the request `AbortSignal` aborts. It reads durable
pipeline and stage rows before blocking and returns immediately when the
pipeline is already at a boundary — a new transition after subscription is
not required.

Wait boundaries:

```json
{ "kind": "terminal", "state": "succeeded" | "failed" | "rejected" | "interrupted" }
{ "kind": "awaiting-approval", "stageId": "<first undecided approval after satisfied predecessors>", "branchKey": "<blocking gate row branchKey>" }
```

`pending` and `running` are not boundaries unless an approval gate row with
satisfied branch-suffix predecessors reads `awaiting` or `pending`; a live wait
returns that `awaiting-approval` envelope even when a sibling branch workflow
stage is `running`. Otherwise a live wait keeps observing through workflow-stage
transitions until the first durable terminal or `awaiting-approval` boundary.
Boundary derivation walks durable stage rows in `loadPipeline` order for the
first unsatisfied approval row after satisfied predecessors within that row's
branch suffix. Terminal states still take precedence over approval boundaries.

Observation substrate: re-read durable pipeline/stage rows after each
in-process `updateStage` (via an in-daemon observer) and on bounded polling
(`FOLLOW_POLL_MS`, same default as log follow) until `AbortSignal`.
No run-log follow and no implicit `pipeline_list` follow loop.

Refusals: missing or empty `pipelineId` → `invalid_params`; unknown durable
ID → `unknown_pipeline` (no wait begins). Aborting a live wait throws
`pipeline_wait aborted` at the handler boundary and does not return a
boundary payload — same cancellation shape as run `wait`. Other wait-time
failures propagate without conversion to abort.

## Library surface

`startIpcServer(socketPath, handlers?)` binds a Unix listener in-process (tests
and daemon host). Custom RPC handlers override built-in `health`/`status` if
provided. `connectIpcClient(socketPath)` is a thin test/caller helper.
Frame encode/decode lives in `v2/src/ipc/`.
