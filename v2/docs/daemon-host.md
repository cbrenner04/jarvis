# Daemon host IPC

Hermetic Unix-domain-socket transport for the v2 daemon host. Wire shape only in this slice — run orchestration verbs and log payload semantics land in sibling work.

See [v2-architecture.md](./v2-architecture.md) Interface for daemon-first placement; this doc pins the transport contract only.

Operator-facing `jarvis daemon ...` and `jarvis run ...` behavior lives in [`write-behavior.md`](./write-behavior.md).

Daemon-hosted work, including finalization (the ready gate and draft-to-ready flip), must not block unrelated IPC. No daemon-hosted path may use a synchronous child process; `bun run check` guards `v2/**` and `shared/**` against it.

## Restart reconciliation and recovery

Before opening its IPC listener, a daemon reconciles durable `queued`, `in-progress`, `paused`, and `budget-soft-stopped` runs whose **admitting process is gone**. Every run row records `owner_identity` (`<pid>:<process-start-epoch>`, stamped by `createRun` — daemon admission, `jarvis write`, and the workflow runner all stamp their own process's identity, not a daemon-specific one). State-store admission marks `reconciliation_pending` and the applicable reconciliation finish metadata but does not write terminal status; a row is admitted only if it has no recorded owner (pre-migration row) or its owner differs from the sweeping process *and* that owner is no longer alive (pid gone, or pid reused — different start epoch). A row owned by the sweeping process itself, or by any other still-live process (a live foreground `jarvis write` or workflow runner, or another daemon), is left untouched — reconciliation is scoped to dead incarnations, not merely non-terminal status. The daemon reloads each pending row, preserves any boundary-terminal winner, chooses `interrupted` for a durable `review-debate` row and `killed` otherwise, and synchronously calls `commitTerminalRunSettlement` with no event-loop yield after that final status check. The atomic settlement stamps `finished_at`; it omits `terminalCause` and `terminalFailureDetail` because neither operator kill nor `daemon_restart` is an honest invocation/write-loop failure classification. Immediate `list` and `wait` therefore observe the terminal status and finish metadata without waiting for a structured-log append. State or log reconciliation failure aborts startup before IPC serves. Reconciliation retains worktrees, branches, attempts, checkpoints, queued input, and workflow snapshots; it does not reclaim worktrees.

Kill and reconcile never overwrite a boundary-terminal row status (`completed`, `blocked`, `failed`, `interrupted`); `paused` is not boundary-terminal. An active `paused` row (a live `activeRuns` entry) is killable through the ordinary abort path. A `paused` row with no `activeRuns` entry anywhere — e.g. the daemon that owned its loop is gone but reconciliation can't reach it because a *different*, still-live process now owns the row — has no abort path; it settles only through `kill`'s `force` path (see the `kill` RPC row). After terminal settlement, the daemon appends `run_reconciled` with the settled `killed` or `interrupted` status and `reason: "daemon_restart"`, then clears `reconciliation_pending`. A failed append leaves pending set so the next sweep retries history without re-settling or re-timing the terminal row; an already-matching event is suppressed, and a pending row that has since reached a boundary-terminal status gets its pending flag cleared with no reconcile event. Concurrent or repeated sweeps do not re-stamp admission finish metadata once pending is set.

`commitTerminalRunSettlement` is the only daemon-owned terminal run writer. Execution paths under the daemon source tree still own `commitCompletionBoundary`; that attempt-boundary migration is separate.

Startup order after run/log reconciliation: the IPC listener opens; then the pipeline-continuation sweep (below) runs and is awaited to completion; then orphaned pipelines settle; then reconciled runs are admitted through `resume`. Health and all other IPC calls remain available while this work runs.

The pipeline-continuation sweep (`recoverContinuablePipelines`) re-drives, in addition to the ordinarily-continuable pipelines it always has, any pipeline carrying a `running` stage row still marked `failureDetail: { code: "settlement_deferred", reason: "entry_run_still_live" }` — the marker `dispatchPipelineStage` leaves when a prior daemon died between its entry run reaching a durable terminal status and that status being delivered back to the stage row, or when `dispatchPipelineStage`'s catch path returns while the admitted entry run is still live — and any `running` stage row with no deferred marker whose linked entry run's durable sibling rows roll up to terminally `failed` (`unsettledTerminalStageEntryRunId`). A marker is redrivable once its linked entry run is durably terminal (or its row is gone entirely); the no-marker wedge is redrivable only when rollup is `failed`, not when rollup is `completed`. Neither predicate is redrivable while the linked entry run is still genuinely live, or when the entry run is a member of this same start's just-reconciled run-ids (that case settles through `recoverReconciledRuns` below instead, so the sweep doesn't fail the stage out from under a run that reconciliation is independently resuming). `hasRedrivableDeferredSettlement` admits a pipeline when either predicate resolves on any stage row. A redrivable stage is admitted into `continuePipeline`, which recomputes settlement from the entry run's durable rows — not from the marker's previously-recorded (and now possibly stale) rollup status — and clears the marker on success. A row a prior restart already settled `interrupted` is out of the re-drive's reach on any later restart, since it no longer carries the deferred marker.

Orphaned-pipeline settlement (`store.reconcilePipelines()`, run right after the continuation sweep): an `active` pipeline owned by a dead or absent prior incarnation is marked `interrupted`, and each of its active stages (`pipeline_stages.status` outside `pending`, `awaiting`, `approved`, `rejected`, and outside the terminal/blocked-suffix set `succeeded`/`failed`/`interrupted`/`skipped`) is marked `interrupted` alongside it, preserving completed stages and leaving undispatched (`pending`), decided approval rows, and blocked-suffix (`skipped`) rows untouched. A pipeline owned by the sweeping process or another still-live process is left unchanged, and an already-`interrupted` pipeline is never a candidate (idempotent across restarts). This step only settles orphans — it does not re-dispatch or re-admit them.

Once orphaned-pipeline settlement completes, the daemon automatically admits every row that the pre-IPC startup sweep reconciled through the normal snapshot-backed write `resume` path. Recovery reuses the durable run ID, workflow snapshot, worktree, and branch. Each successful admission appends `run_recovery` with `outcome: "resumed"`. A snapshot-less or otherwise unresolvable row is not admitted and stays `killed` with `unsupported_resume_context`. Any other admission failure atomically settles that row to `failed` with `terminalCause: "invocation_failure"` and bounded `terminalFailureDetail: { failureKind: "error", bindingAttempts: [], message }`, then best-effort appends `run_recovery` with `outcome: "failed"` and the same diagnostic; it does not block later reconciled rows.

## Socket path

Callers supply `socketPath` explicitly. There is no production default, stale-socket recovery, or max concurrent client cap in the library. The CLI, [`jarvis tui`](./write-behavior.md#tui-cli) (IPC `start` consumer over the production socket), [`jarvis tui log <run-id>`](./write-behavior.md#tui-cli) (IPC tail consumer over the same socket), and daemon lifecycle commands key socket, PID, and process-log paths by the invoking executable digest: derived from the SHA-256 digest of tracked blobs under `v2/src/**`, `shared/**`, and repo manifests, with a 16-hex-char leading slice to stay within the macOS `sun_path` limit (104 bytes). The keyed path format is `~/.jarvis/daemon-<key>.sock`, `~/.jarvis/daemon-<key>.pid`, and `~/.jarvis/daemon-<key>.log`. This allows multiple daemons keyed by different executable digests to coexist: each connects to its own socket, PID file, and process log, with no interference.

Multiple daemons coexisting by keyed socket create a corresponding accumulation of sockets: one per executable digest ever run. Under one shared `JARVIS_HOME`, durable run rows are shared across keyed daemons — a row created by one daemon is visible to all daemons querying the same state store. Liveness (`isLive`) and live controls (`pause`, `kill`) are scoped to the owning daemon only: a run launched by daemon A remains `isLive: true` only in A's responses until the loop settles.

When a new daemon starts (after rebuilding the executable, for example), it sends a `supersede` RPC to every other `daemon-<key>.sock` in `~/.jarvis`, best-effort and non-blocking: supersede sends are fire-and-forget after the new daemon's own server is listening, do not gate startup, and errors (unreachable socket, RPC failure) are ignored. A superseded daemon continues answering on its socket but stops admitting new work: new `start`/`resume` requests on a superseded socket fail with code `daemon_superseded`. Runs launched by a superseded daemon remain in-progress until settled; once settled, the daemon disappears on its own as callers switch to the new keyed socket.

`jarvis cleanup` removes dead sockets (those whose listeners have exited) via a connect-attempt probe: if the probe receives `ECONNREFUSED` or `ENOENT`, the socket is dead and removed; all other error states (timeout, permission error, unexpected error) preserve the socket and are reported. Live sockets — those a daemon is currently answering on, whether the invoking digest or a superseded keyed daemon — are never removed.

### Socket discovery

Observers enumerate live coexisting daemons by discovering live sockets: enumerating `daemon-<key>.sock` entries under `~/.jarvis`, probing each for liveness via a `health` RPC call (which succeeds immediately if a daemon is running and listening), and collecting those that respond within a short timeout. Only sockets that answer `health` successfully are considered live; stale socket files that do not connect are excluded. Discovery returns results in lexicographic order for deterministic enumeration.

`jarvis run list`, `jarvis run log`, and `jarvis run wait` union discovered live sockets with the invoking digest's socket, issue `list` on each (skipping sockets whose `list` fails), merge rows by run ID with `isLive` preference, and use the owning socket for log streams and `wait`. Bulk `jarvis cleanup` eligibility uses the same socket query set and skip-on-failure semantics for `list`-based live-run checks (not for `--abandon` or stale-reset claim probes, which remain keyed-socket only). When no queried daemon lists the run, `log` and `wait` fall back to the invoking socket (same as before a digest rotation).

## Framing

One connection carries length-prefixed UTF-8 JSON frames:

1. Four-byte big-endian unsigned length of the JSON body.
2. UTF-8 JSON object body.

Framing failures — bad length (over cap), truncated body, invalid JSON — close the connection. The listener keeps serving other clients.

## Envelope `kind` union

| `kind` | Role |
| --- | --- |
| `request` | RPC call: `{ kind, id, method, params? }` |
| `response` | RPC success: `{ kind, id, result }` |
| `error` | RPC failure: `{ kind, id, code, message }` |
| `stream-open` | Open multiplexed stream: `{ kind, streamId, payload? }` |
| `stream-data` | Stream chunk: `{ kind, streamId, payload? }` (`payload` is base64 bytes) |
| `stream-end` | Close stream: `{ kind, streamId, payload? }` |

Request/response pairs correlate by `id`. `error` carries the same `id` when replying to a request.

Valid JSON with missing or invalid `kind` closes the connection.

## RPC methods (transport slice)

| `method` | `params` | `result` | Meaning |
| --- | --- | --- | --- |
| `health` | — | `{ ok: true }` | Channel liveness |
| `status` | — | `{ state: "running", loadedRevision: string, loadedExecutableDigest: string, recovery: { pending: boolean, reconciled: number, resumed: number } }` | Daemon-host liveness only — not run orchestration status. `loadedRevision` is the daemon's recorded Git HEAD at startup. `loadedExecutableDigest` is the SHA-256 digest of tracked blobs under `v2/src/**`, `shared/**`, and repo manifests at daemon boot. `recovery` is pending until all startup admissions finish; then its stable counts name rows reconciled and successfully auto-resumed. Unsupported and failed admissions are not resumed. |
| `supersede` | — | `{ ok: true }` | Marks this daemon as superseded by a newer executable. A superseded daemon continues answering on its socket but stops admitting new work: subsequent `start` and `resume` calls are rejected with code `daemon_superseded`. Called by a starting daemon after its server is listening, best-effort and non-blocking (errors are ignored). |
| `start` | `{ input: WriteLoopInput } \| { steps: AnyWorkflowStep[] }` | `{ runId: string }` | Exactly one of `input`/`steps`; both, neither, or an empty `steps` array is rejected `invalid_params`. `{ input }` spawns a write loop in the background, or persists it `queued` if memory headroom is unavailable; returns immediately with run ID either way (see [Admission guards](#admission-guards-for-start-and-resume)). Rejected `daemon_superseded` if the daemon is retiring (see [Daemon retirement on supersession](#daemon-retirement-on-supersession)). Rejected `worktree_claimed` if an existing queued run holds the `(project, branch)` key, or if memory headroom is clear and the key is claimed by a live run. `{ steps }` dispatches to `executeWorkflow` with `freshDispatch: true`, creating new run rows for every step and minting a fresh `invocationId`; prior `completed` runs are not reused. A linked implement first materializes and validates its managed worktree; failure returns `worktree_materialization_failed` with that path and the Git or validation reason, before routing or a run row. Returns `{ runId }` for step 0 once its run row is durably created; the workflow then keeps running in the background. A `firstStep.workflowInvocationId` request whose prior run is non-terminal (`in-progress`, `paused`, `budget-soft-stopped`) and owned by another invocation is rejected `worktree_claimed` (intent ownership guard). Terminal prior runs (`completed`, `failed`, `blocked`, `killed`) do not block a fresh request, allowing new runs to start; a prior row force-settled `killed` via `kill`'s `force` path (see the `kill` RPC row) is an ordinary terminal row here too, so it stops blocking a fresh request under a different `invocationId` the same way. Rejected `insufficient_memory` (not queued) if memory headroom is unavailable at call time. Other failures before step 0's run row exists (e.g. an invalid step shape) return an error rather than hanging, surfacing `executeWorkflow`'s thrown message as `invalid_params`. |
| `list` | `{ sinceMs?: number; limit?: number; project?: string; branch?: string; specPath?: string; status?: RunStatus; includeDismissed?: boolean }` | `{ runs: Array<{runId, project, branch, createdAt, status, isLive, loopOutcomeKind?, iterationsConsumed?, resumable?, error?, reviewPasses?, reviewBehavior?, workflow?, stepId?, finishedAtMs?, prNumber?, prUrl?, dismissedAt}> }` | List durable runs merged with in-memory liveness; `isLive=true` only while the loop's Promise is executing. After spawn-boundary executor failure: `status: "failed"`, `isLive: false` (see [Spawn-boundary failure capture](#spawn-boundary-failure-capture)). `createdAt` is the durable run admission timestamp (ms since epoch). Optional outcome fields; optional `error` on non-success terminals (see [Operator error on list and wait](#operator-error-on-list-and-wait)). Optional `prNumber` and `prUrl` when publication confirmed a PR. `stepId` names the durable workflow step when the row backs a snapshot step; omitted on ordinary single-step runs. `finishedAtMs` is present and non-null for terminal statuses (`completed`, `failed`, `blocked`, `killed`, `interrupted`) reached through current durable transitions and is the maximum of non-null run `finished_at`, attempt `completed_at`, and run `reconciled_at` finish sources; it is omitted while the run is non-terminal. Legacy or unbackfilled rows and rows created terminal without a durable transition are not backfilled by list projection and may omit it — clients such as `jarvis tui` use it for live terminal-window filtering, not for default CLI list retention. Workflow-backed rows may also carry authored per-step progress (see [Workflow snapshots on list rows](#workflow-snapshots-on-list-rows)). Implement workflow rows may also carry retained `reviewPasses` and `reviewBehavior` (see [Implement review selection on list rows](#implement-review-selection-on-list-rows)). For workflow entry rows (the returned run id from a `start { steps }` invocation), `status` reflects a rollup over all steps in the invocation: the first authored durable step's terminal-but-not-completed status, `killed` if an authored durable step has no row in a non-live invocation, or `completed` if all authored durable steps are completed; while the workflow is live, status is `in-progress` regardless of step row state. When a stopping sibling owns the terminal outcome, entry `loopOutcomeKind`, `iterationsConsumed`, and `error` come from that sibling, while `resumable` remains eligible only when the entry row itself can resume. Other step rows in that workflow report their own durable statuses. `dismissedAt` is the durable dismissal timestamp (ms), `null` when not dismissed — present on every row regardless of `includeDismissed`. By default `list` excludes rows with a non-null `dismissedAt`; pass `includeDismissed: true` (strict `=== true` — a truthy non-boolean like the string `"true"` does not opt in) to include them. The dismissal exclusion applies on both the retained (default) and the filtered (`sinceMs`/dimension) path — a filtered request that matches a dismissed row still omits it unless `includeDismissed` is set — and runs ahead of both terminal retention and the filtered-path `limit` slice: a dismissed run consumes neither a terminal-retention slot nor a filtered-limit slot, so dismissing frees a slot for a previously-evicted run. `includeDismissed` is not itself a filter field for `limit`/`sinceMs`/dimension purposes and does not bypass terminal retention on its own — a bare `{ includeDismissed: true }` request still returns at most the 50 newest terminal runs. Dismissal is display-only: durable state, by-id reads (`wait`/`kill`/`pause`/`resume`, `tail`), and reconciliation/restart sweeps still see and can drive a dismissed run; only this default `list` projection hides it. `resolveRunOwnerSocket` (cross-daemon run routing for `run log`/`run tail`) and `jarvis cleanup`'s daemon-list safety reads (`createBulkCleanupDaemonClient`, `createStaleResetDaemonClient`) opt into `includeDismissed: true` on every `list` call so a dismissed-but-live run keeps routing and keeps blocking worktree retirement correctly; only display callers (`jarvis run list` and the TUI) adopt the default exclusion. `jarvis run list --all` is the CLI opt-in back into `includeDismissed: true`. Terminal runs (`completed`, `failed`, `blocked`, `killed`, `interrupted`) are bounded to the 50 newest by creation time; all other statuses are exempt and always returned. Step runs of a listed workflow invocation are retained with that invocation regardless of the bound. Retention filters the response only — durable rows are kept (see [Terminal run list retention](#terminal-run-list-retention)). When any list filter field is set (`sinceMs`, `project`, `branch`, `specPath`, or `status`), matching durable rows are returned newest-first and terminal retention is bypassed; dimension filters match store columns exactly and compose conjunctively with each other and with `sinceMs`; the response is capped to `limit` when provided or **200** when omitted. `limit` alone does not select the filtered path. |
| `dismiss` | `{ runId: string }` | `{ kind: "applied", runId, status } \| { kind: "refused", runId, reason: "run_not_found" }` | Marks a run dismissed (`dismissed_at`) so it drops out of the default `list` projection. Missing/empty `runId` → `invalid_params`. Unknown `runId` → `{ kind: "refused", reason: "run_not_found" }`, returned as the RPC `result`, not an error frame. No `daemon_superseded` guard — dismissal admits no execution, so a retiring daemon has nothing to protect. Idempotent, inherited from the store: a repeat dismiss on an already-dismissed run returns `applied` with the original `dismissedAt` unchanged (first-writer-wins). Dismissing changes only `dismissed_at` — no `activeRuns` lookup, no abort, no status write; a live run keeps running under the hood and stays `isLive: true` under `includeDismissed: true`. `applied` additionally carries the durable row's current `status` (not the workflow rollup status `list` reports) so a caller dismissing live work can warn; `refused` carries no `status`. |
| `undismiss` | `{ runId: string }` | `{ kind: "applied", runId, status } \| { kind: "refused", runId, reason: "run_not_found" }` | Clears `dismissed_at`, returning the run to the default `list` projection. Same `invalid_params` / unknown-id `refused` shape and no `daemon_superseded` guard as `dismiss`. Idempotent: undismissing a never-dismissed run is also `applied` and leaves `dismissed_at` null. Nothing here (nor `resume`, reconciliation, or restart recovery) is blocked by a dismissed run — all can still drive one; it simply stays out of every default listing until undismissed or a caller opts into `includeDismissed`. |
| `pause` | `{ runId: string }` | `{ ok: true }` | Signal graceful pause for an active run. The run continues at the next iteration boundary (in-flight step is not aborted). Rejected `run_not_active` if run is unknown, not active, or is a workflow-started run (see [Live controls on workflow-started runs](#live-controls-on-workflow-started-runs)). |
| `kill` | `{ runId: string; force?: boolean }` | `{ ok: true }` | Abort the run's signal immediately and, after a final synchronous durable-status guard, atomically settle `killed` through `commitTerminalRunSettlement` when the row is not boundary-terminal (`completed`, `blocked`, `failed`, `interrupted`). The daemon owns active-run and boundary admission; the store owns the admitted atomic status/`finished_at` write. Workflow-started rows defer settlement until invocation and repair quiesce; the managed worktree lock releases before settlement, while the daemon registry claim releases only after `killed` is durable, so same-key admission cannot precede terminal observation. Leaves the worktree dirty. Accepts any live run, including workflow-started step rows (see [Live controls on workflow-started runs](#live-controls-on-workflow-started-runs)). An active row (`activeRuns` holds a matching entry) always takes this abort path regardless of `force`. Rejected `run_not_active` if run is unknown or not active — unless `force: true` and the row is non-active and non-terminal and its owner is this process or provably dead: after that asynchronous liveness check, the daemon reloads status and calls settlement without an intervening yield. The force path has no abort signal and no worktree/lock release. `force` on a different still-live owner, or on any terminal row, is rejected `run_not_active` unchanged. Kill settlement omits `terminalCause` and `terminalFailureDetail`; immediate `list`/`wait` still observe `killed` and `finishedAtMs` without a later log append. |
| `resume` | `{ runId: string }` | `{ ok: true }` | Resumes workflow write runs when shared snapshot reconstruction succeeds and the same admission predicate that projects `list`/`wait` `resumable` (`nextAction: "resume"` on the composed operator error; see [Operator error on list and wait](#operator-error-on-list-and-wait)). Rejected `daemon_superseded` if the daemon is retiring (see [Daemon retirement on supersession](#daemon-retirement-on-supersession)). The matching persisted step must retain non-empty rules, artifact path, agents, model config, and resolvable bindings; the reconstructed input preserves step identity, workflow snapshot, and timeout. Missing or invalid context returns `resume_unsupported` before claim/spawn. Accepted reasons include every composition that yields `nextAction: "resume"` (e.g. `resumable_pause`, `resumable_budget`, `resumable_kill`, `completion_commit_failed`, `ready_gate_failed`, `surviving_mutation_failed`, `landing_failed`, `invalid_token`, `missing_blocker`, resumable `contract_miss` on `implement~shrink`); compositions yielding `nextAction: "stop"` / `"inspect_spec"` / `"fix_config"` / `"retry_later"` are rejected with `terminal_run` whose message names the owning recovery from `RUN_OPERATOR_ERROR_RECOVERY` (see `run-operator-error.ts`). Ad-hoc stopped runs remain unsupported. A row owned by a durable review-behavior step (a durable `implement-review`, or a durable `review-debate` last step — never a non-durable light `implement-review` sharing that step ID) whose terminal `loop_finished` names `surviving_mutation_failed`, `ready_gate_failed`, or `completion_commit_failed` does not go through this snapshot-field reconstruction — its own `stepRules`/`expectedArtifactPath` are review-shaped, not write-shaped. It resolves through completion-step / publication-tail reconstruction instead: the durable write step's completed sibling row is resolved by workflow `invocationId`, matching either the authored write stepId or a completed `<stepId>~link-N` row (the shape a linked-implement workflow's terminal pass persists), picking the terminal completed candidate when several exist. That selected row supplies the publication `worktreePath`, base ref, and `specPath`; conflicting fields recorded on the review row itself never override it. Resume then commits any uncommitted worktree changes and replays mutation re-verification, the ready gate, and publication without re-invoking the completed write step's agent. The other two outcome kinds are admitted for self-consistency — only this same resume path ever writes them onto a review-behavior row — not because a fresh review pass can settle them; `runtime_smoke_failed` from this same tail is excluded (retrying cannot change that outcome) and reports `unsupported_resume_context` instead, even when its own `loop_finished` record says `resumable: true`. |
| `wait` | `{ runId: string }` | `{ runStatus, loopOutcomeKind?, iterationsConsumed?, resumable?, error? }` | Long-running one-shot wait for the next invocation boundary. Durable `terminalCause` and `terminalFailureDetail` project immediately without waiting for a structured terminal log append; rows without those fields retain attempt/log fallback. On a workflow entry, whichever durable sibling row owns the rollup `surviving_mutation_failed` — a hidden `~shrink` row or a durable review row alike — supplies outcome fields and error detail (chronologically last terminal record wins among multiple candidates); entry resumability remains tied to the entry row. Unsupported stopped write context returns `error: { reason: "unsupported_resume_context", retryable: false, nextAction: "stop" }` and forces `resumable: false`, even when the historical loop record was resumable. Otherwise behavior is unchanged; optional `error` matches `list` for the same run (see [Operator error on list and wait](#operator-error-on-list-and-wait)). |
| `pipeline_start` | `{ definition: PipelineDefinition, context: PipelineContext }` | `{ pipelineId: string }` | Admit a validated pipeline definition plus execution context: validate `context` through `loadPipelineContext` before `createPipeline` (missing required fields → `invalid_params` with the loader message; no pipeline row or stage rows are created), durably record the validated immutable snapshot on the pipeline row in the same transaction as the definition and stage rows, reload that snapshot through the same loader, start the ordered daemon-owned loop (`runPipeline`) from the reloaded bytes — not from the RPC `context` object — and return `{ pipelineId }` only after that admission transaction succeeds — not when the pipeline finishes. Missing `definition` or `context` → `invalid_params`. Context supplied but not durably persisted, or durable reload failing validation after a successful admit → `admission_failed` (no pipeline ID returned on the pre-admit refusal path only; post-admit durable round-trip failures use `admission_failed` after rows exist). The handler does not re-run `validatePipelineDefinition`; callers must validate before RPC. See [Ordered pipeline progression](#ordered-pipeline-progression). |
| `pipeline_approve` | `{ pipelineId: string, stageId: string, branchKey?: string }` | `{ kind: "applied", pipelineId, stageId, decision: "approved" } \| { kind: "refused", pipelineId, stageId, reason }` | Admit `approved` on the authored `stageId` row through `commitApprovalDecision`, then asynchronously continue the ordered loop from persisted admission context when the write applies. Optional `branchKey` targets one branch row; when multiple non-`skipped` branch rows exist at the stage and `branchKey` is omitted, the handler refuses with `branch_key_required`. Missing/empty `pipelineId` or `stageId` → `invalid_params`. Retiring daemon → `daemon_superseded`. Refused store outcomes (`pipeline_not_found`, `stage_not_found`, `not_approval_stage`, `status_not_awaiting`, etc.) return unchanged with no dispatch. Duplicate or racing decisions are refused without a second continuation. The handler resolves after the durable write, not after continuation finishes. See [Pipeline approval decisions](#pipeline-approval-decisions). |
| `pipeline_reject` | `{ pipelineId: string, stageId: string, branchKey?: string }` | `{ kind: "applied", pipelineId, stageId, decision: "rejected" } \| { kind: "refused", pipelineId, stageId, reason }` | Admit `rejected` on the authored `stageId` row through `commitApprovalDecision` and never dispatch later stages for that branch. Optional `branchKey` targets one branch row; when multiple non-`skipped` branch rows exist at the stage and `branchKey` is omitted, the handler refuses with `branch_key_required`. Missing/empty `pipelineId` or `stageId` → `invalid_params`. Retiring daemon → `daemon_superseded`. Refused store outcomes (`pipeline_not_found`, `stage_not_found`, `not_approval_stage`, `status_not_awaiting`, etc.) propagate without mutation or dispatch. The handler resolves after the durable write. See [Pipeline approval decisions](#pipeline-approval-decisions). |
| `pipeline_resume` | `{ pipelineId: string, branchKey?: string, resetDespiteDirty?: boolean, resetDespiteLandedCriteria?: boolean }` | `{ kind: "resumed", pipelineId } \| { kind: "refused", pipelineId, reason } \| { kind: "refused", pipelineId, branchKey, stageId?, status?, reason }` | Stage-scoped resume for failed and `awaiting-approval` pipelines only. Missing/empty `pipelineId` → `invalid_params`. A present `branchKey` that is not a string, or is blank after trimming, → `invalid_params` before `resumePipeline` runs; a non-blank `branchKey` forwards unchanged (untrimmed) to `resumePipeline`'s `options.branchKey`, scoping admission and dispatch to that one fan-out branch (see [Pipeline stage-scoped resume](#pipeline-stage-scoped-resume)); omission and `branchKey: "default"` retain the unscoped whole-pipeline path. Retiring daemon → `daemon_superseded`, checked ahead of `branchKey` validation. Derived `succeeded` → `pipeline_terminal_succeeded`; derived `rejected` → `pipeline_terminal_rejected`; derived `running`, fresh `pending`, or `interrupted` → `pipeline_not_resumable` — each without stage dispatch, except a derived-`running` pipeline carrying a stage row wedged `settlement_deferred`/`entry_run_still_live` behind a durably terminal linked entry run (`resumeDrivesDeferredSettlement`), which resume admits and drives through `continuePipeline` with no reopen, same detached shape as the other admitted paths. `resetDespiteDirty` and `resetDespiteLandedCriteria` independently thread to the reopened stage's shared stale-reset dirty and landed-criteria flags; a failed plan redraft sets the dirty flag automatically. Derived `failed` applies `reopenFailedPipeline` when a `failed` row remains, then asynchronously continues via `continuePipeline` from persisted admission context; already-reopened failures (`reopenedFailurePermitsActivation`, derived `pending`) skip reopen and continue only the eligible failed stage while preserving every predecessor `workflowInvocationId`. Derived `awaiting-approval` claims ownership via `claimPipelineContinuation` but never calls `continuePipeline` — the gate row stays `awaiting` with no later dispatch; missing persisted admission context → `missing_context`; `claimPipelineContinuation` refusal → `claim_refused`. `isPipelineContinuable` and startup `recoverContinuablePipelines` do not treat awaiting pipelines as continuable. Ineligible failed shapes surface the store reopen refusal (`no_failed_stage`, `multiple_failed_stages`, `malformed_continuation`, etc.) without dispatch. The handler resolves after reopen and/or claim admission (or refusal), not after detached continuation finishes. See [Pipeline stage-scoped resume](#pipeline-stage-scoped-resume). |
| `pipeline_recover` | `{ pipelineId: string, branchKey: string, resetDespiteDirty?: boolean, resetDespiteLandedCriteria?: boolean }` | `{ kind: "admitted", pipelineId, branchKey, stageId, entryRunId } \| { kind: "resolution_refused", pipelineId, branchKey, reason, message } \| { kind: "stage_claimed", pipelineId, branchKey, stageId }` | The optional reset fields are admitted for wire parity but ignored: recovery preserves and lands the corrected staged tree without stale reset. Branch-scoped blocked plan-stage recovery, opt-in only — never fired by restart continuation. Missing/empty `pipelineId` or `branchKey` → `invalid_params`. Retiring daemon → `daemon_superseded`. Resolves the target via `resolveBlockedPlanStageRecoveryTarget`; an unresolvable target returns `{ kind: "resolution_refused", reason, message }` with its named reason (see [Branch-scoped blocked plan-stage recovery](#branch-scoped-blocked-plan-stage-recovery)) and no mutation. After resolution, shared `admitWorkflowStart` applies the same queued/live ownership and memory refusal order as workflow `start` before durable stage admission; `worktree_claimed` and `insufficient_memory` are RPC errors, while a held durable stage-admission claim returns `{ kind: "stage_claimed" }`. On admission the handler registers a `recovery`-kind `activeRuns` entry and always detaches attempt, settlement, and branch continuation from the RPC response. The response never carries the attempt's outcome — only `{ kind: "admitted" }` or a pre-attempt refusal; the settled result is observable afterward on the stage row via `pipeline_list` (`status`, `artifact`, `failureDetail`). Registry, `activeRuns`, durable stage admission, and the log sink roll back on every pre-attempt refusal or exception; an admitted recovery releases them only after the detached chain finishes. A retiring daemon with an in-flight detached recovery is not idle: `hasActiveRuns()` stays true until settlement completes. See [Branch-scoped blocked plan-stage recovery](#branch-scoped-blocked-plan-stage-recovery). |
| `pipeline_dismiss` | `{ pipelineId: string }` | `{ kind: "applied", pipelineId, state } \| { kind: "refused", pipelineId, reason: "pipeline_not_found" }` | Marks a pipeline dismissed (`dismissed_at`) so it drops out of the default `pipeline_list` projection. Missing/empty `pipelineId` → `invalid_params`. Unknown `pipelineId` → `{ kind: "refused", reason: "pipeline_not_found" }`, returned as the RPC `result`, not an error frame. No `daemon_superseded` guard — dismissal admits no execution, so a retiring daemon has nothing to protect. Idempotent, inherited from the store: a repeat dismiss on an already-dismissed pipeline returns `applied` with the original `dismissedAt` unchanged (first-writer-wins). Dismissing changes only `dismissed_at` — no stage dispatch, no gate settlement, no ownership change, no `activeRuns` entry; a `running` pipeline keeps running under the hood. `applied` additionally carries derived `state` (`derivePipelineState`) so a caller can warn when dismissing non-terminal work; `refused` carries no `state`. |
| `pipeline_undismiss` | `{ pipelineId: string }` | `{ kind: "applied", pipelineId, state } \| { kind: "refused", pipelineId, reason: "pipeline_not_found" }` | Clears `dismissed_at`, returning the pipeline to the default `pipeline_list` projection. Same `invalid_params` / unknown-id `refused` shape and no `daemon_superseded` guard as `pipeline_dismiss`. Idempotent: undismissing a never-dismissed pipeline is also `applied`. Nothing here (nor `pipeline_resume`, `pipeline_recover`, or restart recovery) is blocked by a dismissed pipeline — all three can still drive one; it simply stays out of every default listing until undismissed or a caller opts into `includeDismissed`. |
| `pipeline_list` | `{ includeDismissed?: boolean }` | `{ pipelines: Array<{ pipelineId, name, state, terminalAction?, seedPath?, terminalPublicationSucceededAt, terminalPublicationFailure, createdAt, finishedAtMs, dismissedAt, stages: Array<{ id, stageId, branchKey, position, status, workflowInvocationId, startedAt, endedAt, decidedAt, artifact, failureDetail }> }> }` | Durable snapshot of admitted pipelines without following live transitions. By default, excludes pipelines with a non-null `dismissedAt`; pass `includeDismissed: true` (strict `=== true` — a truthy non-boolean like the string `"true"` does not opt in) to include them. Empty store → `{ pipelines: [] }`. `terminalAction` is the admitted definition value; `seedPath` is the unchanged durable admission-context value and may be relative to admission `cwd`, which is not exposed. Either optional field is omitted when absent. Terminal-publication fields and stage `artifact`/`failureDetail` preserve durable JSON `null`; publication success/failure are mutually exclusive. `createdAt` is the durable pipeline row admission timestamp (ms). `finishedAtMs` is `null` while derived `state` is non-terminal; for terminal states it is `terminalPublicationSucceededAt` when set, otherwise the maximum non-null stage `endedAt` or approval `decidedAt`, otherwise `createdAt`. `dismissedAt` is the durable dismissal timestamp (ms), `null` when not dismissed — present on every snapshot regardless of `includeDismissed`. Stage `startedAt`, `endedAt`, and approval `decidedAt` are milliseconds since epoch; `decidedAt` is the durable approval decision time and is `null` before decision and on non-approval stages. Thus a rejected or approved-final gate supplies `finishedAtMs` when no terminal-publication success or later durable finish exists. A dispatch throw before entry-run admission projects the durable failed-before-start row unchanged: `status: "failed"`, numeric `endedAt`, `startedAt: null`, and `workflowInvocationId: null`; no start is synthesized. Stage order follows stored authored `position` then `branch_key`. Derived `state` uses `derivePipelineState` (see [Pipeline snapshots](#pipeline-snapshots)). Durable state retains dismissed pipelines — the store and restart sweeps still see them; only this default projection hides them. |
| `pipeline_wait` | `{ pipelineId: string }` | `{ kind: "terminal", state } \| { kind: "awaiting-approval", stageId, branchKey }` | Block until the named pipeline reaches a wait boundary or the request `AbortSignal` aborts. Returns immediately when already at a boundary. Missing/empty `pipelineId` → `invalid_params`; unknown ID → `unknown_pipeline` (no wait begins). Abort throws `pipeline_wait aborted` with no boundary payload. Other failures propagate without masking as abort. See [Pipeline wait](#pipeline-wait). |

Unknown `method` returns `error` correlated to the request `id` (connection stays open).

Entry `list` uses the same outcome selection while retaining the workflow rollup status.

### Terminal run list retention

`list` returns at most the 50 newest terminal runs — statuses `completed`, `failed`, `blocked`, `killed`, and `interrupted` — ordered by `created_at` descending with `rowid` as a tiebreak. All other statuses (`in-progress`, `queued`, `paused`, `budget-soft-stopped`) are exempt: they are always returned and do not consume retention slots. Dismissed runs (`dismissedAt` non-null) are filtered out ahead of this retention window unless `includeDismissed: true` is set, so a dismissed run consumes no retention slot and dismissing one frees a slot for a previously-evicted run.

When a workflow invocation has any retained run, every step run sharing that invocation's `workflowSnapshot.invocationId` is retained too, including terminal step runs older than the 50-newest terminal bound. Companion step runs do not consume retention slots.

When any list filter field is set on `list` (`sinceMs`, `project`, `branch`, `specPath`, or `status`), both the 50-newest terminal cap and invocation-sibling retention are skipped. Matching durable rows are returned newest-first (`created_at DESC`, `rowid DESC`), then capped to `limit` when provided or **200** when omitted. `project`, `branch`, `specPath`, and `status` each match the durable store column exactly (case-sensitive) and compose conjunctively with each other and with `sinceMs`. For `sinceMs`, matching means `created_at >= sinceMs`. Durable rows are still not deleted; only the response is filtered.

`limit` without a filter field does not enter this path; the daemon does not use `limit` to reduce row count on the retention path. See [Terminal run list retention](#terminal-run-list-retention) for the default list behavior.

Retention is applied to the durable row set before per-row `loadRun` and log replay, so retired runs are not loaded while serving `list`. Durable rows are not deleted — `loadRun` and other store reads still return retired runs. `jarvis run list` and `jarvis tui` render every run the daemon returns and apply no bound of their own.

### Wait result contract

`wait` validates `params.runId` before reading logs. Missing or empty `runId` returns `invalid_params`; unknown runs return `unknown_run`. A linked implement materialization failure before routing or step 0's row exists returns `worktree_materialization_failed`, with the managed worktree path and underlying Git or validation reason. A later routing-index read returns `routing_read_failed`, with the resolved index path and underlying read reason; other pre-row rejections remain `invalid_params`.

The response is deferred on the same request `id` while a run is in progress. Other RPCs on that connection continue to receive normal correlated responses while the wait is pending. Disconnecting the socket detaches only that waiter: no response is sent for the abandoned request, the durable run is unchanged, and other waiters for the same run continue.

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

When a run is not a clean in-progress or success terminal, `list` rows and `wait` results may include:

```json
{ "reason": "<closed-reason>", "retryable": false, "nextAction": "<closed-action>" }
```

No raw attempt transcripts or exit codes appear in this contract. `invocation_error` may include the persisted bounded final-binding stderr tail or daemon diagnostic as `message`; daemon `model_config` failures may include their bounded binding-resolution diagnostic.

For `ready_gate_failed`, terminal command evidence adds optional `message`: it names the resolved gate command and includes the bounded terminal output when present, and pipeline settlement persists the same composed object in stage `failureDetail`. Legacy terminal rows without command evidence keep the reason/retryability/action-only shape; `ready_gate_out_of_scope` keeps its existing outside-path fields, resumability, and no `message`.

| Field | Meaning |
| --- | --- |
| `reason` | Closed stop category (not raw `failureKind` or `loopOutcomeKind`) |
| `retryable` | Whether the operator may retry/resume without fixing underlying state |
| `nextAction` | Closed remediation hint (`resume` \| `inspect_spec` \| `fix_config` \| `retry_later` \| `stop`) |
| `message` | Optional bounded diagnostic for ready-gate evidence, binding-chain `invocation_error`, or daemon-owned invocation/model-config failure |

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
| `role_stalled` | review-step `invocation_failure` + `failureKind: "stall"` (role-layer idle kill or successor-shell pre-agent stall) | `true` | `retry_later` |
| `iteration_timeout` | failed `loopOutcomeKind: "iteration_timeout"` with `resumable: false` | `false` | `stop` |
| `iteration_timeout` (resumable) | failed `loopOutcomeKind: "iteration_timeout"` with `resumable: true` (at least one criteria-complete linked subspec) | `true` | `resume` |
| `idle_output_timeout` | failed `loopOutcomeKind: "idle_output_timeout"` with `resumable: false`, or store-only attempt `outcome_kind: "idle_output_timeout"` without a matching terminal `loop_finished` | `false` | `stop` |
| `idle_output_timeout` (resumable) | failed `loopOutcomeKind: "idle_output_timeout"` with `resumable: true` (boundary checkpoint produced a fresh `iteration_commit` `commitSha`) | `true` | `resume` |
| `harness_failure` | terminal `run_execution_failed` without a post-boundary lock message, or `failed` without mappable attempt detail | `false` | `stop` |
| `state_store_lock_timeout` | terminal `run_execution_failed` whose `message` names SQLite lock contention after a committed write-step `done` boundary | `true` | `resume` |
| `unsupported_resume_context` | stopped or publication-retry write run whose snapshot cannot reconstruct an executable step | `false` | `stop` |
| `completion_commit_failed` | `loopOutcomeKind: "completion_commit_failed"` on a `failed` row | `true` | `resume` |
| `ready_gate_failed` | `loopOutcomeKind: "ready_gate_failed"` on a `failed` row | `true` | `resume` |
| `ready_gate_out_of_scope` (unchanged outside paths) | `loopOutcomeKind: "ready_gate_out_of_scope"` with `resumable: false` on a `failed` row | `false` | `stop` |
| `ready_gate_out_of_scope` (changed outside paths) | `loopOutcomeKind: "ready_gate_out_of_scope"` with `resumable: true` on a `failed` row | `true` | `resume` |
| `surviving_mutation_failed` | `loopOutcomeKind: "surviving_mutation_failed"` on a `failed` row | `true` | `resume` |
| `ready_flip_failed` | `loopOutcomeKind: "ready_flip_failed"` on a `completed` row | `false` | `stop` |

For binding-chain `invocation_error`, persisted `InvocationFailureDetail.message` projects to `error.message` only when `failureKind` is `error`; it is the bounded final-binding stderr tail. Daemon-owned durable failure detail projects its bounded message for `failureKind: "error"` and `failureKind: "model_config"`. Message-less rows and other invocation failure kinds omit it. For `completion_commit_failed`, `error.publicationFailure` on both `list` and `wait` contains the failed operation, message, exit code, and bounded labelled stdout/stderr tails from the terminal `loop_finished` row. Terminal `completionCommitError` also projects to `error.completionCommitError` without re-normalization (may coexist with `error.publicationFailure`) on the owning durable row — typically a hidden `~shrink` sibling, not the workflow entry row; dirty `no-work` over uncommitted tracked paths uses the same projection (not `completed`). For intent-split landing-contract settlements, optional terminal `message` projects unchanged to `landing_failed` `error.message` on `list` and `wait`; cause-less legacy rows and unrelated `landing_failed` origins omit it. Pipeline non-success settlement mirrors the same optional field in stage `failureDetail`. For `iteration_timeout`, `error.completedSubspecPaths` and `error.remainingSubspecPaths` mirror the terminal `loop_finished` lists; `error.publicationFailure` survives alongside inventory when present on the same row. For `idle_output_timeout`, `error.retryable` and `error.nextAction` mirror terminal `loop_finished.resumable` on the same row; store-only attempt detail without a matching terminal log stays `stop` / non-retryable. `ready_flip_failed` is terminal non-resumable and also carries `error.publicationFailure` from that row; `completion_commit_failed`, `ready_gate_failed`, and resumable `ready_gate_out_of_scope` are retryable. `ready_gate_failed` and `ready_gate_out_of_scope` do **not** populate `error.publicationFailure` — gate evidence lives on the terminal `loop_finished` row (`readyGateError` message; inspect with `jarvis run log`). For `ready_gate_out_of_scope`, `error` also carries `readyGateOutsidePaths` and `readyGateOutOfScopeDetail` from that row; unchanged outside paths settle `resumable: false` with `nextAction: stop` (resume admission rejects). For `surviving_mutation_failed`, `error` also carries `survivingMutation`, `survivingMutationSourceFile`, and `survivingMutationSourceLine` from the terminal `loop_finished` row. For `contract_miss`, `error.contractMissDetail` carries the chronologically last `contract_miss_detail.failureReason` from the run log when the log tail is readable; omitted when `logReader` is absent (store-only composition) or when the chronologically last `contract_miss_detail` lacks `failureReason`. `jarvis run log` remains the full excerpt. When `ready_flip_failed` occurs after the publisher returned a PR number, `error.prNumber` on `list` and `wait` identifies the PR for manual fixing; omitted when publication returned no PR.

A failed hidden shrink publication row remains `failed` and resumable; the workflow entry row rolls up to `failed` rather than `completed`.

Every publication-tail outcome, `surviving_mutation_failed` included, settles on the workflow's durable completion row regardless of which step actually produced it — status per outcome is as listed above. A non-durable last step (e.g. a light review with no landing) redirects the tail to the completion step's hidden `~shrink` row when one exists, else that step's own row, so the terminal record always lands on a row `list`/`wait` can see.

**Omission:** `error` is absent on `in-progress` runs and on `completed` runs with no operator-actionable stop.

**Composition:** `composeRunOperatorError` reads durable `loadRun` first. Non-null `terminalCause` and its `terminalFailureDetail` are authoritative, so `list` and `wait` expose atomic settlement evidence before or without a terminal log; only legacy rows without durable cause use attempts and the chronologically last terminal log record (`loop_finished` or `run_execution_failed`). `list` replays persisted logs per row via injected `logReader` (no `follow`) and passes that tail into the composer; `contractMissDetail` is sourced from the chronologically last `contract_miss_detail` in that tail when the row composes to `contract_miss`. When `logReader` is absent (tests), `list` composes store-only without the tail and does not fail the RPC — `contractMissDetail` is omitted. `wait` and `list` share one composer and the same fallback/enrichment rules.

**Tie-break:** Durable `terminalCause`/`terminalFailureDetail` wins over terminal logs and attempts. For legacy rows, attempt `outcome_kind: "invalid_token"` or `"missing_blocker"` wins over generic `resumable_pause` when `runStatus: "paused"`. A terminal `loop_finished` with `loopOutcomeKind: "contract_miss"` and `resumable: true` composes to `contract_miss` / `resume` (post-commit shrink miss). Durable `runStatus` wins for resumable terminals (`killed`, `paused`, `budget-soft-stopped`). For legacy `failed` / `blocked` rows, a resumable finalization `loop_finished` outranks last-attempt detail; otherwise last-attempt detail wins. Failed or blocked legacy rows with no mappable attempt detail ignore stale resumable logs and usually report `harness_failure`. Message-less legacy `run_execution_failed` records still compose `harness_failure`; only a lock message after a committed `done` boundary maps to `state_store_lock_timeout`.

**`error.retryable` vs `wait.resumable`:** `error.retryable` is the operator-action signal on the error contract. `list` and `wait` project `resumable` from the same admission predicate that gates `resume` (`nextAction: "resume"` on the composed operator error), so advertised `resumable` and resume admission agree by construction. Unsupported snapshot context still forces `resumable: false` on the row (and `nextAction: "stop"` on the surfaced error) even when the historical `loop_finished` record was resumable. The persisted `loop_finished` event in `jarvis run log` is unchanged — the loop's settle-time self-report, not the row contract. `resumable` may be absent on store-only quiescent resolves that carry no terminal `loop_finished` fields (e.g. `killed` without persisted loop outcome).

Malformed `error` fields reject the entire `list` / `wait` payload (strict `daemon-wire` parsing).

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

Implement workflow `list` rows may include top-level `reviewPasses` and `reviewBehavior` fields copied from the durable workflow snapshot at launch time:

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

`activeRuns` entries carry a `kind` discriminant: `write-loop` for bare `start` (`{ input }`) runs, `workflow` for runs started via `{ steps }`. A workflow invocation registers one shared `AbortController` on the claim row plus a `workflow`-kind entry for every step `runId` as each row is durably created (`onStepRunCreated`); those entries stay until the invocation's background work finishes and `.finally` bulk-deletes them — not only while a given step is in-flight. The claim row is not an operator `kill` target id (after `start` returns, step 0's `runId` is the entry id).

`kill` succeeds when `activeRuns` holds a `workflow` row whose `runId` equals the argument (same lookup shape as write-loop: ownership key, then run id). Authorization is that live row only — no stall, idle-age, or subprocess inference. `list` `isLive` is durable `in-progress` ∧ membership in the live set from `activeRuns`; when `isLive` is true for a step id, `kill` must succeed. The converse is not required: a row may remain in `activeRuns` briefly after durable status is no longer `in-progress` during unwind.

`kill` on an authorized workflow row aborts the shared controller (stopping in-flight agent work on any still-running step) and queues guarded terminal settlement for the **named** `runId` only. Settlement runs after the invocation and any finalization repair quiesce and the managed `.jarvis.lock` is released; the daemon registry claim releases immediately after, so `killed` is durable before (never after) the registry admits a same-key workflow. A boundary-terminal durable row (`completed`, `blocked`, `failed`, `interrupted`) is preserved while abort still stops the graph — including `kill` on a **completed** sibling step id while a later step is still tracked and in flight. The named non-terminal step becomes durable `killed`; terminal siblings stay unchanged; the workflow entry row rolls up to `killed` after settlement (not workflow `failed` from abort unwind alone). Non-live workflow rows (no matching `activeRuns` entry) reject `kill` with `run_not_active` unless `force: true`: a non-terminal such row (owner this process or provably dead) settles durably `killed` outright through the force path (see the `kill` RPC row), rather than deferring to invocation/repair quiescence — there is no live graph to abort or lock to release.

`pause` and `resume` reject workflow-started rows with `run_not_active` (same code as an absent or non-active run); only ad-hoc `write-loop` rows carry `pauseController` / write-loop `resume` plumbing.

### Daemon retirement on supersession

When a newer daemon starts, it broadcasts a `supersede` RPC to every other daemon socket discovered in `~/.jarvis`, best-effort and non-blocking. A superseded daemon flips to a retiring state: subsequent `start` and `resume` calls are rejected with code `daemon_superseded` before any claim, run row, or worktree materialization. Runs already admitted by the retiring daemon — including those in-flight — continue executing under that daemon and reach their normal outcomes (paused, killed, completed, failed, blocked) without interference. The retiring daemon does not promote queued runs.

Once the retiring daemon's active-run set is idle (empty), the daemon exits automatically. A retiring daemon with no active runs exits immediately and without operator action. Live observation methods (`health`, `status`, `list`, `wait`, log tail, `pause`, `kill`) remain available while the daemon is retiring and finishing its active work; callers may continue steering in-flight runs until they settle.

Worktree locks, agent child processes, and log sinks stay with the admitting daemon that spawned them; a superseded daemon releases its own work only.

### Admission guards for `start` and `resume`

There is no global single in-flight guard — multiple runs may be active concurrently across different `(project, branch)` keys.

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

### Shared workflow-start admission

Fresh `{ steps }` workflow starts, daemon pipeline dispatch (`defaultPipelineDispatch` → `handleWorkflowStart`), and `pipeline_recover` (after recovery-specific validation and effect-free target resolution) all enter `admitWorkflowStart` in `daemon.ts`. That boundary reclaims stale workflow registry claims, applies the same queued/live ownership and memory checks as standalone workflow `start`, acquires the linked `(project, branch)` registry claim and an `activeRuns` entry, then calls lifecycle-specific durable admission. A lifecycle refusal or exception before execution begins rolls common acquisition back; admitted lifecycles retain distinct execution and settlement — workflow runs stay `kind: "workflow"` through `startWorkflowRun`, while recovery stays `kind: "recovery"` until detached attempt, settlement, and continuation finish and its log closes.

## Streaming

Streams multiplex on the same connection via `stream-open` / `stream-data` / `stream-end`. The `stream-open` payload carries `{ runId: string, afterSeq?: number, follow?: boolean }` to identify the run and optionally resume from a prior log position. The `afterSeq` field specifies a cursor: the server emits only persisted records with `seq > afterSeq`, then streams new appends. Absent, non-numeric, or negative `afterSeq` resolves to `0` (full replay). Follow subscribe uses `max(last replayed seq, afterSeq)` to dedupe appends past the replay.

`follow` defaults to `false`: after replay, the server closes the stream with `stream-end` regardless of the run's status — this is snapshot mode, and completion is the server closing after replay, independent of the run settling. When `follow: true` and the run is `in-progress`, the server instead streams new appends as `stream-data` frames — one record per frame — until the client closes with `stream-end` or the connection drops; that continued-tail completion is separate from snapshot mode's replay-then-close. Each record is a `PersistedRecord` serialized as JSON in the `payload` field.

In follow mode the server also re-reads the run's status from the state store: once immediately after replay (before entering the follow loop), then again after each record `follow()` yields, and independently on a fixed timer (`FOLLOW_POLL_MS`, configurable via `followStatusPollMs` for tests) so an empty poll tick — no new record — still triggers a re-read. This matters because a run can go terminal without appending a further record (e.g. a kill), which would otherwise leave a record-triggered-only re-read blocked forever. Once status is terminal (`isTerminalRunStatus`), the server stops consuming `follow()` and closes the stream with `stream-end` on its own — an operator following a run to completion no longer needs Ctrl-C or a separate `run wait`/`run list` to notice it settled. Before closing, the server re-reads `tail()` once more and emits any record beyond the last one delivered, so a record appended at or after the status flip (e.g. `workflow-runner.ts` commits `runStatus: "completed"` before appending `loop_finished`) is drained, not dropped.

RPC traffic on the same connection keeps `id` correlation while a stream is open.

## Daemon lifecycle API

The daemon is a detached child process. Callers interact via three programmatic functions in `v2/src/daemon/daemon-lifecycle.ts`.

### `startDaemon(socketPath, options?)`

Spawns a detached child running `v2/src/daemon/daemon.ts`. Returns metadata `{pid,
socketPath}` or throws on startup failure.

**Injected paths:** Callers must supply an explicit `socketPath`; the daemon environment variable is `DAEMON_SOCKET_PATH`. Tests may inject `pidPath` (for cleanup); `daemonScript` (test override); `readinessTimeoutMs` (default 5s); `logPath` (process-level stdio capture); and `logCapBytes` (rotation cap, default 5 MiB).

**Log path:** When `logPath` is provided, child stdout and stderr are opened in append mode before spawn and inherited by the child. Missing or unwritable log directory throws before spawn. Caller closes its fd copy after spawn. When `logPath` is omitted, stdio remains discarded (existing behavior).

**Log rotation:** At spawn time, if the existing log file is at or over `logCapBytes`, it is rotated to `<logPath>.1`, replacing any prior `.1`. Rotation is checked once at spawn; a long-lived daemon may exceed the cap, and the bound holds across restarts.

**Process-log boundary:** `<logPath>` carries process-level output (uncaught exceptions, spawn failures, stray harness stderr). Run and agent output flows through the persisted log store and log-server stream path, not `<logPath>`. Concurrent daemons sharing one `logPath` are unsupported; double-start protection covers the real case.

**CLI default:** The CLI pins `~/.jarvis/daemon.log` alongside `daemon.sock` and `daemon.pid`; other callers supply `logPath` explicitly or omit it to discard.

**Double-start protection:** If the socket already responds to `health`, throws `DaemonAlreadyRunningError` (no second child spawned).

**Readiness:** Polls the socket for `health` response. Throws `DaemonReadinessTimeoutError` if the child is alive but socket doesn't respond within `readinessTimeoutMs`.

### `stopDaemon(socketPath, options?)`

Normal shutdown first reads the durable run store. `in-progress`, `paused`, `budget-soft-stopped`, and `queued` rows refuse the stop and report every run ID. The refusal happens before shutdown, process signals, or PID cleanup. A store read failure also refuses the stop.

`completed`, `failed`, `blocked`, and `killed` rows do not block. With `force: true`, the durable guard is skipped and the existing graceful shutdown path is used: RPC `shutdown`, SIGTERM, bounded wait, SIGKILL if needed, and `pidPath` cleanup.

**Drain:** Signals server to reject new connections and drain in-flight IPC (default 2s). Waits bounded time (default 3s) for process exit after SIGTERM.

**Process-only fallback:** If socket is unreachable, signals the process directly. If `pidPath` is not provided, external signal handling is required.

### `getDaemonStatus(pid, socketPath, options?)`

Returns `"running"` only if process is alive AND socket responds to `health` in short timeout (default 1s). Returns `"stopped"` on any liveness or transport failure.

**Probe order:** Process liveness first (no socket I/O if dead). Prevents false "running" states from stale sockets.

### `jarvis daemon log [--follow]`

Reads `<logPath>` (the process-level log from `startDaemon`'s [Log path](#startdaemonsocketpath-options) above) directly off disk — no PID, socket, or IPC-status check, so it works whether or not the daemon is running. Operator-facing CLI contract: [`write-behavior.md` § Daemon CLI](./write-behavior.md#daemon-cli).

Implementation: `v2/src/daemon/daemon-process-log.ts` (`readDaemonProcessLog` / `followDaemonProcessLog`). `--follow` replays retained bytes then polls (`FOLLOW_POLL_MS`, 200ms — separate from the 250ms poll interval in [`log-stream.ts`](../src/persistence/log-stream.ts)'s structured-log follow) for appends, tracking file identity by inode: a shrink or inode change resumes from the current file at the configured path; a missing path reports on stderr and stops with a nonzero exit.

## In-memory worktree ownership

The daemon holds a registry keyed by `{ project: string, branch: string }`. Each entry records `{ runId, worktreePath }`.

**Registry methods:**
- `claim(key, ownership)` — acquires ownership; throws `DaemonDoubleClaimError`
  on double-claim (no overwrite).
- `release(key)` — releases ownership; no-op if key not held.
- `get(key)` — returns ownership or undefined.
- `isClaimed(key)` — boolean test.

**No disk writes:** Registry is in-memory only. Cross-process coordination uses `.jarvis.lock` and git worktrees locking (unchanged).

Workflow settlement releases both ownership layers around terminal observation: the invocation and finalization repair first quiesce, then the managed-worktree owner releases `.jarvis.lock`. For `completed` and `failed`, the daemon workflow `finally` releases the registry claim before exposing the durable status. For `killed`, guarded admission and `commitTerminalRunSettlement` durably persist `killed` first, and only then does the daemon workflow `finally` release the registry claim — so a same-key start is never admitted before `killed` is durable. This includes daemon kill during repair. A same-key implement start is therefore admissible immediately after terminal observation, without joining deferred workflow work.

## Spawn-boundary failure capture

When the factory's background `writeLoopExecutor` rejects (harness fault outside normal `loop_finished` settlement), capture runs in the spawn IIFE after the RPC returns — `start` and `resume` share this path:

1. If durable status is not already settled (`completed`, `blocked`, `killed`, `paused`, `failed`), best-effort `commitTerminalRunSettlement({ status: "failed", terminalCause: "invocation_failure", terminalFailureDetail: { failureKind: "error", bindingAttempts: [], message } })`. Persist errors do not block cleanup.
2. Await the injected `failureReporter(runId, reason)` with the original rejection value (production: open log sink via `logsPath`, append one `run_execution_failed` event, close sink).
3. Release in-memory worktree ownership and active-run entries (`finally`), then run normal queue promotion.

Does not call `commitCompletionBoundary`; latest attempt may stay `in-progress`. Does not rethrow to RPC callers or emit daemon stderr — diagnostics flow through the reporter contract only.

**Dual-outage (out of scope):** When both `stateStore` and the log reporter are unreachable on failure, no orphan repair is attempted.

**Post-failure operator shape:** settlement is durable before the reporter runs, so immediate `list` and `wait` report `failed`, `loopOutcomeKind: "invocation_failure"`, and `invocation_error` with the bounded diagnostic even when `run_execution_failed` is not yet available. The later event remains lifecycle history. A new `start` for the same `(project, branch)` is accepted once cleanup releases ownership.

### Workflow async-path failure capture

When `executeWorkflow` rejects after step 0's run row exists (harness fault outside normal per-step `loop_finished` settlement), `startWorkflowRun` settles every non-terminal run id tracked for the workflow:

1. If durable status is not already settled (`completed`, `blocked`, `killed`, `paused`, `failed`), best-effort atomically settle `failed` with `terminalCause: "invocation_failure"` and bounded `terminalFailureDetail: { failureKind: "error", bindingAttempts: [], message }`. Persist errors do not block the append.
2. Best-effort append one `run_execution_failed` event with `message` through the workflow's open log sink. The append follows durable settlement and remains lifecycle history; it is skipped when `logsPath` is unset.
3. Release workflow worktree ownership and active-run entries, clear live review progress, and close the sink (`finally`).

Ordering is fixed per run id: atomic durable settlement → append → `finally`. `list` and `wait` consume the durable cause/detail immediately; they do not depend on append timing.

`paused` and `killed` rows are left as-is with no terminal record — resumability and kill semantics outrank failure reporting. A rejection before step 0's run row exists still resolves the `start` RPC with `invalid_params` instead of settling background runs.

Does not use `failureReporter` (spawn-boundary reporter is message-less). Does not call `commitCompletionBoundary`; latest attempt may stay `in-progress`. Does not rethrow to RPC callers once step 0 has resolved.

**Post-failure operator shape:** settled workflow runs report `status: "failed"`, `isLive: false`, `loopOutcomeKind: "invocation_failure"`, and `invocation_error` with the durable diagnostic. Worktree ownership releases normally so a new `start` on the same `(project, branch)` is accepted after cleanup.

## Memory watermark

`memory.minFreeGb` in the active machine profile (`config/machines/<profile>.json`, same file as the `models` key) sets a free-memory floor in GB. Unset (or `memory` key absent) means no gating. When present, `minFreeGb` must be a positive finite number — `0`, negative, or non-numeric values throw at profile load, matching `models` validation.

`hasMemoryHeadroom(profileName: string, freeMemReader?)` in `v2/src/daemon/memory-watermark.ts` reports whether current free memory clears the configured floor: `true` when unconfigured, else compares an injectable free-memory reader (default `os.freemem`) against the floor converted to bytes. Wired into `start` admission (see [Admission guards](#admission-guards-for-start-and-resume)).

`createRunControlHandlers`'s default `hasMemoryHeadroom`/`settleDelayMs` deps resolve `profileName` via `resolveMachineProfile()` ([`machine-config-loader.ts`](../src/config/machine-config-loader.ts)), which reads the required `machineProfile` key from `~/.jarvis/config.json` — not a hardcoded profile name. A missing or empty `machineProfile` hard-fails `start`.

### Promotion of queued runs

Promotion logic is `promoteQueuedRunImpl`, a standalone function in `v2/src/daemon/daemon.ts` (deps: state store, `WorktreeOwnershipRegistry`, memory-headroom check, settle-delay duration/state, `spawnWriteLoop` callback) — unit-testable without an IPC socket. `createRunControlHandlers` binds it once (`promoteQueuedRun`) and calls that binding from two trigger points, not a poll timer: after `start` admits or queues a run, and inside `spawnWriteLoop`'s `finally` block — the single place that releases a run's `activeRuns` entry and registry claim on every exit path, including a run reaching `paused`.

Each trigger considers `queued` runs oldest (`created_at`) first, skipping any whose `(project, branch)` key is currently claimed in favor of the next-oldest eligible one, and promotes at most one run per call: sets its status to `in-progress`, then spawns it from its persisted `WriteLoopInput`. Workflow-step queued inputs pass persisted `bindingResolution` context (`role`/`agents`/historical `agentModelConfig`) through `resolveWriteLoopBindings`, which loads rungs from the current machine profile; refusal atomically settles the row `failed` with `terminalCause: "invocation_failure"` and bounded `terminalFailureDetail: { failureKind: "model_config", bindingAttempts: [], message }`, without spawning it. Ad-hoc inputs keep bare agent-id binding rehydration until they gain resolver context. No preemption — promotion only fills free headroom; it never pauses, kills, or otherwise touches an already-running run.

**Settle delay:** after a promotion, further promotions are suppressed for `memory.settleDelayMs` (profile config, default `DEFAULT_SETTLE_DELAY_MS` in `v2/src/config/machine-profile-loader.ts`) before headroom is re-measured, to avoid racing ahead of the just-admitted run's memory footprint ramping up. One exception: `start` performs a one-time immediate recheck (bypassing the settle delay) on the row it just queued, covering the case where memory has already recovered by the time the row is persisted — without it, a queued run with no other run active has no further promotion trigger until the next `start`/exit event.

## Invocation session logs

Each write-loop iteration opens an on-disk transcript at `~/.jarvis/sessions/<run-id>-<timestamp>.log` (default sessions dir; timestamp is millisecond-granularity ISO with `:` replaced for filesystem safety). One file per iteration — not one per run and not one per binding attempt in the fallback chain.

Lines mirror v1: `<ISO ts> [<tag>] <text>` with tags `harness`, `outbound`, `inbound_stdout`, `inbound_stderr`. Before the agent subprocess spawns, the loop writes a `harness` line naming run id, spec path, and iteration number; the invocation layer appends binding `harness`/`outbound` and post-settle `inbound_*` into the same file. When the iteration settles (including timeout, abort, and thrown-error paths), the loop appends a final `harness` line (`outcome=completed|timeout|abort|error`) and closes the file.

These files are orthogonal to the structured log stream (`jarvis run log`, persisted under the daemon logs path): session logs are the first artifact when a run hangs before `iteration_started`/`boundary_committed` rows accrue; the structured stream is the durable run timeline once records exist. See [`invocation-liveness.md`](./invocation-liveness.md) and [`first-workflow-walkthrough.md`](./first-workflow-walkthrough.md).

## Pipeline stage resolution

`pipeline_stages` rows are keyed by `(stageId, branchKey)`; admission and `createPipelineStageBranch` persist branch rows. Persisted stage artifacts may include `downstreamInputs: string[]` of worktree-relative ready-intent file paths; multi-file intent completion records those paths on the stage artifact. The first chained stage after a splitting intent fans out one preset binding per `downstreamInputs` entry (`resolveStageWorkflowSteps` returns `{ ok: true; results }` with one element per path when length ≥ 2); later chained stages resolve from the branch-local preceding artifact and return a single `{ ok: true; steps }`; single-file handoff (file `specPath`, no `downstreamInputs`) is unchanged. See [Branch fan-out execution](#branch-fan-out-execution) for daemon dispatch and settlement.

`v2/src/daemon/pipeline-stage-resolve.ts` turns one `pipeline_stages` row plus pipeline-level context into a `WORKFLOW_PRESET_BUILDERS` call. Admission persists a `PipelineContext` snapshot on the pipeline row (`{ cwd, configPath, targetDir?, projectRegistry?, seed?, seedPath? }`); `runPipeline` reloads and validates that snapshot through `loadPipelineContext` before stage resolution or dispatch.

Posture → preset (`validatePipelineDefinition` in `v2/src/execution/pipeline-definition.ts` is the sole admission authority on which `(workflow, review)` pairs are realizable; this table only maps realizable pairs to builders and is never consulted for validity):

| workflow    | review   | preset                |
| ----------- | -------- | --------------------- |
| `intent`    | `none`   | `intent`              |
| `intent`    | `light`  | `intent-reviewed`     |
| `intent`    | `debate` | `intent` (`reviewPasses: 1`, `reviewBehavior: "debate"`) |
| `plan`      | `none`   | `plan`                |
| `plan`      | `light`  | `plan-reviewed-light` |
| `plan`      | `debate` | `plan-reviewed`       |
| `implement` | `light` or `debate` | the implement builder, with `reviewBehavior` set to the stage's own posture — never the project's configured implement review default |

At admission, only `implement` + `none` is unrealizable (`unrealizable-review-posture`); `intent` + `debate` and every other table row is realizable. `implement` has no unreviewed builder path (same rule as [`workflow-runner.md`](./workflow-runner.md) pipeline posture matrix).

Seed/artifact hand-off: the first workflow stage (by authored position) builds with admitted `PipelineContext.seedPath` as file `seed` or inline `PipelineContext.seed` as `seedText` (never both; `seedPath` wins when both are stored) and `PipelineContext.cwd` as its read root. Every later workflow stage builds from the immediately preceding workflow stage's recorded artifact (approval stages are skipped when walking back to find it): resolution loads the prior stage's entry run via `store.loadRun(artifact.entryRunId)` and sets preset `cwd` to that run's `worktreePath`. Artifact `specPath` is worktree-relative: `readyIntent` for `plan`/`plan-reviewed*` presets; chained implement normalizes directory `specPath` to `<dir>/index.md` in `resolveImplementStage` (see [operator-runbook § Pipeline start](./operator-runbook.md#pipeline-start)). Never joined to admission `cwd` and never absolutized in the store. When the preceding artifact carries `downstreamInputs` with length ≥ 2, the first chained stage after that splitting artifact resolves one preset per listed file path (each bound as `readyIntent`); length 1 binds that path only; absent `downstreamInputs` keeps file `specPath` single-resolution. A listed path missing from the prior worktree fails without falling back to directory `specPath`. Later chained stages (e.g. implement after per-branch plan) resolve from the branch-local preceding artifact only and do not re-iterate intent `downstreamInputs`. Chained implement resolution takes its `baseRef` from the prior entry run's `branch` and checks spec availability against that run's `worktreePath`, not admission `cwd` and not the default branch. When that requested base is absent from `origin` (`git ls-remote --heads` empty or errored), completion publication retargets once to the repository default branch through the full chain (`findOrCreatePr` / `confirmPr`, body refresh, spec body-summary derivation); settlement records `requestedBase` and `resolvedBase` on the stage artifact when publication succeeds after retarget, or on `failureDetail` when publication still fails. The `fast` integration case is the inter-stage worktree handoff proof: it seeds every stage artifact on real stage worktrees and asserts the ready-intent and plan spec tree are absent from the operator checkout.

`reviewPasses` and `reviewBehavior` on built intent/plan/implement inputs are derived from the stage's own `review` posture (`none` → `reviewPasses: 0` with no review behavior; `light`/`debate` → one pass with an explicit matching behavior). Preset names alone do not suppress review — `intent` and `intent-reviewed` share a builder; only `reviewPasses: 0` omits review steps.

`PipelineContext.projectRegistry` is passed through to the implement builder only; intent/plan resolution uses `configPath` (and optional `targetDir`) for project and target-dir lookup, matching the CLI's config-backed registry.

Chained-stage project resolution (`createChainedStageProjectMatch`) maps a prior entry-run `worktreePath` to `{ key, root }`: admission `cwd` uses registry longest-prefix match; `~/.jarvis/worktrees/<registered-key>/` (raw key), `~/.jarvis/intent-work/<project-safe-id>/`, and `~/.jarvis/specs/<project-safe-id>/` (for example `intent-work/demo/<slug>/`, `specs/demo/plans/<name>/`, or `specs/demo/ready-intents/`; `intent-work` and `specs` segments from `projectSafeId(key)`) map to `{ key, root: admissionRoot }` where `root` is pipeline admission `cwd`, not necessarily registry `project.root`; other paths keep the terminal `findProjectMatch` fallback.

Resolution failure: a stage whose `(workflow, review)` pair has no table entry, or whose builder call itself reports `{ ok: false }`, returns `{ ok: false; error: string }` — never a thrown error and never a fallback to a different preset.

## Pipeline stage dispatch

`v2/src/daemon/pipeline-stage-dispatch.ts`'s `dispatchPipelineStage` takes one resolved stage's steps, a `PipelineWorkflowDispatch` callback, a `PipelineWorkflowWait` callback, and the `StateStore`, and drives one stage through to its terminal outcome. The daemon builds both callbacks as thin closures over its own private `handleWorkflowStart`/`startWorkflowRun` machinery and the mechanism backing the `wait` RPC handler — a standalone module cannot reach either directly.

- `PipelineWorkflowDispatch = (steps) => Promise<{ ok: true; entryRunId; invocationId } | { ok: false; code; message }>`.
  A refusal (claimed worktree, insufficient memory, materialization failure,
  routing-read failure, invalid params) records `endedAt`, `status: "failed"`,
  and `failureDetail: { code, message }` immediately — no `startedAt`, no
  `workflowInvocationId`, no retry or queueing.
- A dispatch throw before entry-run admission records a failed-before-start stage with numeric `endedAt`, no `startedAt`, and no workflow linkage. `pipeline_list` projects `startedAt: null` and does not synthesize a start.
- On a successful dispatch, `workflowInvocationId` is set to the admitted entry
  run id (the returned `entryRunId`, not the workflow snapshot `invocationId`
  or a superseded run id). `startedAt` and `status: "running"` are written via
  `StateStore.updateStage` *before* settlement, so a crash mid-stage leaves a
  resolvable linkage. The stage row stays `running` with that linkage until the
  entry run settles — no terminal patch (`failed`, `succeeded`, or `endedAt`)
  is written while the linked entry run is still live.
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
  "failed"`, `endedAt`, and a `failureDetail` — never an artifact reference —
  when the linked entry run is no longer live. While the entry run is still live
  (`isLiveEntryRun`, including `paused` and other non-terminal durable statuses
  such as `budget-soft-stopped`), settlement declines to terminalize: the stage
  row stays `running` without `endedAt` and records deferred
  `failureDetail: { code: "settlement_deferred", reason: "entry_run_still_live",
  entryRunId, rollupStatus }` until a later adopt/settlement attempt succeeds.
  `pipeline_list` surfaces that deferred detail on `running` rows as stored.
  Re-settlement is driven by existing adopt/continue/recovery paths when the
  linked entry run is no longer live: `continuePipeline`, `adoptRunningWorkflowStage`,
  and refused-admission adopt each re-invoke adopt/settlement
  (`adoptAndSettlePipelineStage` / `settlePipelineStageFromEntryRun`). `pipeline_resume`
  drives the same re-settlement on a live daemon when derived `running` reflects exactly
  this wedge (`resumeDrivesDeferredSettlement`); it does not re-invoke adopt/settlement
  for other derived-`running` shapes, which still refuse `pipeline_not_resumable`. Success
  (`rollupStatus === "completed"`) settlement is unchanged: it still terminalizes
  even when the entry run row reads live until the success patch lands. When the
  entry run row is present and settlement is not deferred, `failureDetail` mirrors
  the full `composeRunOperatorError` result (`reason`, `retryable`, `nextAction`,
  and optional detail fields) from the settled entry run with its terminal log
  context (`findTerminalLogRecord` on the entry run's log tail loaded by the
  daemon's `logReader`); when the entry run row is absent, a hand-built
  `{ reason, retryable, nextAction }` harness-failure shape is used. The daemon
  `wait` RPC awaits an in-flight workflow promise when one is registered, then
  reports rollup status from durable sibling rows; after restart or on the adopt
  path, `wait` may resolve a non-`completed` rollup from durable non-terminal
  entry-run state without awaiting — settlement re-checks liveness before
  terminalizing on that rollup rather than trusting it alone.
- Pre-admission throws (before `entryRunId` is linked) record `failed` with
  `{ message }` via a best-effort store write. Post-admission throws or
  rejections while the admitted entry run is still live preserve the `running`
  linkage and defer settlement — no immediate `failed` row.

**Durable `pipeline_stage_admission` (cross-continuation):** before the `dispatch(steps)` callback, `dispatchPipelineStage` atomically claims one durable `pipeline_stage_admission` row keyed by `(pipelineId, stageId, branchKey)` through `StateStore.claimPipelineStageAdmission`. The claim is held until partition completion — entry-run settlement or the existing live-entry early-exit paths — and released through `releasePipelineStageAdmission` with matching holder identity; release never runs when `dispatch(steps)` returns while `wait()` is still outstanding. A refused claim re-reads the stage row: when it is `running` with a live `workflowInvocationId`, the caller adopts and settles through `adoptAndSettlePipelineStage` instead of re-dispatching; otherwise it returns without dispatch and without writing `failed`. This layer coordinates overlapping `continuePipeline` callers for the same stage row. Distinct from in-memory `dispatchClaims` in `pipeline-execution.ts`, which coordinate fan-out sibling dispatch within one `runPipeline` invocation only. After daemon restart, a held `pipeline_stage_admission` row may remain when the owning entry run did not settle and release did not run; clear the row or wait for settlement/release before expecting another dispatch for that stage partition.

Stage status vocabulary (daemon-owned, not interpreted by the state store): `pending` (admitted, undispatched), `running` (dispatched, unsettled), `succeeded`, `failed`, `skipped` (never dispatched because an earlier stage failed — written by the progression loop, not this module).

## Ordered pipeline progression

Cross-file pipeline architecture (definitions, admission snapshot, lifecycle, settlement, fan-out, derived state, terminal publication, operator recovery) is owned by [`pipeline-execution.md`](./pipeline-execution.md). This section covers daemon RPC wiring, startup continuation, and transport-level refusal shapes only. Malformed params and RPC framing stay here; execution semantics link there.

`pipeline_start` (`handlePipelineStart` in `daemon.ts`, registered in `createRunControlHandlers`'s handler map alongside `start`/`list`) admits a `PipelineDefinition` plus a `PipelineContext` only after `loadPipelineContext` accepts the RPC `context` — caller-supplied shape errors return `invalid_params` with the loader message and create no durable rows; the handler does not re-run `validatePipelineDefinition`; callers must validate definition shape before RPC. It calls `StateStore.createPipeline` with the validated snapshot so the immutable admission context is written in the same transaction as the definition and stage rows, reloads that row through the same loader, and starts the ordered loop (`v2/src/daemon/pipeline-execution.ts`'s `runPipeline`) from the reloaded snapshot — the same validated durable bytes restart continuation uses — not from the RPC `context` object reference. It returns `{ pipelineId }` only after that admission transaction succeeds — mirroring `startWorkflowRun`'s "resolve at row creation, keep running after" shape. The loop is not awaited by the handler and does not hold the client connection open; the client disconnecting right after receiving `pipelineId` is what proves daemon (not client) ownership. Exactly one loop instance runs per pipeline, started once from `handlePipelineStart`.

Between two pipeline stages the daemon may have no workflow rows in `activeRuns` (`hasActiveRuns()` is false in the gap after one stage settles and before the next dispatches). That window is normal for same-session retirement: a superseding daemon can exit once `hasActiveRuns()` clears even though the pipeline loop will dispatch the next stage moments later on the admitting daemon.

**Pipeline stage dispatch:** after stage resolution through `prepareWorkflowStart` (stamped steps returned from shared preparation) and any stale-reset preflight, `advanceWorkflowStage` dispatches resolved workflow steps without a second stamping pass; fan-out branch dispatch uses the same prepared bytes. Stamped write steps carry resolved `fixCommand`/`readyCommand` (when configured), write-path iteration bounds (`iterationTimeoutMs`, `iterationCeilingMs`, `idleOutputMs` when armed), and review steps carry `roleTimeoutMs` and configured `idleOutputMs` — the same stamping layer CLI `run workflow` reaches through `prepareWorkflowStart`. Unconfigured project commands stay unstamped on the step object and still resolve to `bun run fix` / `bun run ready` at execution.

Pipeline workflow stages and CLI `run workflow` share preparation, config resolution, stamping, and stale-reset semantics through `prepareWorkflowStart`. For every git-enabled managed write-step workflow stage (`intent`, `plan`, `implement`), `advanceWorkflowStage` (`pipeline-execution.ts`) runs the same `maybeResetStaleWorkspace` preflight as the matching CLI `run workflow` command after stage resolution and before dispatch — closing the gap where a failed-stage re-dispatch reused a poisoned worktree. The preflight runs via shared preparation's `runStaleResetPreflight` with normalized default flags (both skip gates false); a guard refusal fails the stage (`failureDetail.message` matches the CLI's refusal text) without dispatching. No pipeline override flags (`--reset-despite-dirty`/`--reset-despite-landed-criteria`) in this slice — the preflight always runs with default (no-override) gates unless a later slice wires operator equivalents on persisted context.

`runPipeline` and restart continuation (`continuePipeline`) share one validated loader path: each entry reloads the durable `pipelines.context` snapshot through `loadPipelineContext` and uses the validated `cwd`/`configPath` for stage resolution and dispatch — never caller-supplied reconstruction and never raw persisted JSON on the hot path. Incomplete non-null context fails the first pending workflow stage with `failure_detail.message` prefixed by `pipeline-context-loader` and dispatches no workflow run; `context === null` remains `missing_context` on continuation admission only.

`runPipeline` walks `loadPipeline(pipelineId).stages` in authored position order. For each workflow stage it re-reads the stage's own row before acting (not just its loop position), so an already-`running`/settled stage is never re-dispatched — a defensive guard, since the daemon only ever starts one loop per `pipeline_start` call. It then resolves the stage (`pipeline-stage-resolve.ts`) and dispatches it (`pipeline-stage-dispatch.ts`). An approval stage records or honors its durable status before returning: a `pending` row transitions to `awaiting` via `commitApprovalBoundary` under its stable `PipelineStageRecord.id`; `awaiting` blocks progression; `approved` permits the eligible next stage; `rejected` settles the pipeline without later dispatch. Every later undispatched stage stays `pending`. If the boundary write refuses, execution reloads only the addressed row and applies its authoritative `awaiting`/`approved`/`rejected` meaning; any other status settles the pipeline `failed` on that row without dispatching the suffix. See [`state-store.md`](./state-store.md) for conditional approval operations. A stage that settles `failed` — a resolution failure or a dispatch/settlement failure per `pipeline-stage-dispatch.ts` (including a start-time dispatch refusal) — settles the pipeline `failed` by writing `status: "skipped"` to every later stage via `updateStage` and dispatching none of them; there is no best-effort continuation past a failure. Stage resolution and stale-reset refusals call `failWorkflowStageAt`, which always records `failed` immediately — those paths run before dispatch, so no live linkage exists and there is no live-link short-circuit. Live-link guards before terminalizing a `running` row remain on `advanceWorkflowStage` re-entry adopt, its catch handler, and `failStrandedPipelineStage`.

Every daemon settlement patch for a terminal stage-run status (`succeeded`, `failed`, `interrupted`, or `skipped`) explicitly carries numeric `endedAt`, including skipped suffix rows and fan-out default rows. `approved` and `rejected` are approval decisions, not terminal stage-run statuses, and are excluded from this guarantee.

Ownership-key contention: a stage whose steps target a `(project, branch)` already claimed by another in-flight workflow or pipeline is refused at dispatch time through the daemon's existing single-claim `WorktreeOwnershipRegistry` — the same refusal path as `workflow.start` — recorded as that stage's failure. This slice adds no pipeline-level queueing beyond the existing registry; two pipelines targeting the same project concurrently is out of scope. Observability: pipeline stage runs are not yet attributable to their owning pipeline in `workflow.list`/CLI run listings — deferred. RPC pipeline inspection is available through `pipeline_list`; CLI pipeline inspection remains unavailable. Internal repository reads `loadPipeline` and `listPipelines` can inspect persisted pipeline and stage state; [`state-store.md`](./state-store.md) is their single contract home.

### Branch fan-out execution

When a splitting intent stage succeeds with `downstreamInputs` length ≥ 2, `runPipeline` admits one pending branch row per downstream ready-intent file for every authored stage after the splitting stage. `branchKey` is the ready-intent file basename without `.md`. Pre-admitted `default` rows for those downstream stages are reconciled to `skipped` so they never dispatch. The first chained workflow stage after the split resolves fan-out (`{ ok: true; results }`) and dispatches each result to its matching `branchKey`; later workflow stages on a branch resolve from branch-local preceding artifacts only. In-memory stage artifact resolution (the `Map<string, PipelineStageArtifact>` threaded through one pipeline invocation) is scoped by `(stageId, branchKey)` — one branch's artifact never leaks into a sibling's resolution. `skipRemainingStages` applies within one `branchKey` — one branch failure does not skip sibling branches. `pipeline_approve` / `pipeline_reject` accept optional `branchKey` and refuse with `branch_key_required` when multiple branch rows exist and it is omitted. `derivePipelineState` aggregates fan-out branches settlement-first: live `running` siblings and reachable undecided gates or actionable `pending` successors keep aggregate state non-terminal while another branch has settled `failed`/`rejected`; terminally failed/rejected branches count as settled (dead-branch `pending` rows do not block terminality). After every branch stage settles, `rejected` still precedes `failed` before `succeeded`. Terminal `succeeded` requires every branch to succeed. `derivePipelineFailureDetail` names failed or rejected `branchKey`s when aggregate state is non-`succeeded` at derivation time. `pipeline_list` and `pipeline_wait` project `branchKey` on every durable stage row and name `awaiting-approval` boundaries with the blocking gate's `branchKey`. Multi-branch terminal publication when every implement branch succeeds is unchanged / deferred. Slug: `pipeline-intent-split-fan-out-execution`.

Sibling branches dispatch **concurrently**, not serially. Two seams (`runPipeline`'s suffix walk across `activeSplit.branchKeys`, and `advanceFanOutBranches`'s admission-time dispatch of every branch admitted by a shared fan-out stage resolution) build one lazy dispatch thunk per branch and run them together — a slow or deferred branch's entry-run wait never blocks a sibling's dispatch. Because every branch's own suffix walk independently resolves the *same* shared fan-out stage (the fan-out decision lives on the intent artifact, not on which `branchKey` is walking), a per-pipeline-invocation in-memory `dispatchClaims` map (`pipelineId`-scoped, never durable; distinct from durable `pipeline_stage_admission` in `dispatchPipelineStage`) makes exactly one concurrently-racing branch admit and dispatch every sibling for that `stageId`; every other branch awaits that claim — a real `await`, never a busy-wait — instead of re-admitting or re-dispatching. That wait is bounded by `peerClaimTimeoutMs` (10 minutes by default): if the claiming branch never releases it, the losing branch's own row settles a named `pipeline-stage-resolve: timed out ...` failure instead of hanging, unless the claiming branch already dispatched and settled it, in which case the losing branch simply carries the settled row forward. The same claim mechanism guards adoption of an already-`running` live-linked row so a branch's own walk and a peer's fan-out dispatch loop can never both call `wait()` and write a terminal patch for the same row. Concurrent dispatch tasks are aggregated with `Promise.allSettled`, not `Promise.all`: a sibling's failure never leaves another sibling's walk running past settlement.

### Restart-safe pipeline continuation

On daemon startup, after run orphan reconciliation and before pipeline orphan reconciliation, `continueContinuablePipelines` walks every `active` or reconciled- `interrupted` pipeline whose derived state is `pending`, whose `context` snapshot is present, and whose recorded owner is dead or `NULL`. For each candidate it calls `continuePipeline` (`pipeline-execution.ts`): load the persisted admission context from the durable pipeline row (never caller-supplied reconstruction), atomically claim one live owner through `StateStore.claimPipelineContinuation` (`priorOwnerIdentity` must match the row; first writer wins; restores `status = 'active'`), then resume the ordered `runPipeline` loop. Predecessor workflow artifacts are read from succeeded stage rows during that walk — the same carry-forward path as a same-session loop.

A losing or duplicate claim is refused with no stage-row mutation and no dispatch. Continuation does not activate `awaiting-approval` or `rejected` pipelines (those require an explicit approval decision first, or are terminal). A `failed` pipeline is not activated until `reopenFailedPipeline` has been applied in place — activation then resumes at the reopened continuation row without re-dispatching succeeded predecessors. Pipelines that remain unclaimed after this pass are settled `interrupted` by `reconcilePipelines` as before; eligible pipelines reconciled in an earlier daemon incarnation become activatable again when `claimPipelineContinuation` restores `active` ownership.

`isPipelineContinuable` returns true when `isPipelineSettlementPending` is true (every authored stage satisfied but terminal publication has not succeeded) regardless of derived `pending`, so restart can finish never-attempted settlement. Otherwise it composes `derivePipelineState`, `approvalOutcomePermitsActivation` (no `awaiting`/`rejected` approval rows), and `reopenedFailurePermitsActivation` (no remaining `failed` rows). Approved gates with a pending workflow successor and reopened failed continuations both satisfy these guards when derived state is `pending`.

### Pipeline approval decisions

`pipeline_approve` and `pipeline_reject` (`handlePipelineApprovalDecisionHandler` in `daemon.ts`) target one authored `stageId` under a `pipelineId`, optionally scoped by `branchKey` when multiple branch rows exist. The handler resolves that `stageId` (and `branchKey` when supplied) to a single durable stage row, then admits the decision through `StateStore.commitApprovalDecision` on the row's stable `PipelineStageRecord.id` — never by pipeline ID alone. When multiple non-`skipped` branch rows exist at the stage and `branchKey` is omitted, the handler refuses with `branch_key_required`. Missing or empty `pipelineId`/`stageId` → `invalid_params`. A retiring (superseded) daemon rejects both methods with `daemon_superseded`, matching other mutating pipeline RPC retirement.

On an applied `pipeline_approve`, the handler returns the applied outcome and detaches; `continuePipeline` runs asynchronously from the persisted admission context (no caller-supplied reconstruction). On an applied `pipeline_reject`, the handler returns after the durable write and never dispatches later stages. The first atomically admitted matching decision wins; duplicate or racing decisions return the store's named refusal (`status_not_awaiting`, etc.) with no additional dispatch and no mutation of other stage rows. Refused targets (`pipeline_not_found`, `stage_not_found`, `not_approval_stage`, non-`awaiting` rows, invalid decisions) propagate the store reason without fail-open progression.

`applyPipelineApprovalDecision` in `pipeline-execution.ts` admits through `commitPipelineApprovalDecision` and detaches `continuePipeline` on applied approve, passing the approved `branchKey` when supplied so post-approve suffix selection runs only that branch until the next approval gate. Recovery paths (`recoverContinuablePipelines`, unscoped `resumePipeline`) call `continuePipeline` without a `branchKey` and may walk every actionable fan-out branch; branch-scoped `resumePipeline` is the exception — it passes the requested `branchKey` through to `continuePipeline` so only that branch's suffix dispatches (see [Pipeline stage-scoped resume](#pipeline-stage-scoped-resume)).

### Pipeline stage-scoped resume

`pipeline_resume` (`handlePipelineResumeHandler` in `daemon.ts`) is the sole daemon-owned stage-scoped resume entry point. It composes `derivePipelineState`, `reopenFailedPipeline`, `claimPipelineContinuation`, and `continuePipeline` in `pipeline-execution.ts` — never translating resume into `pipeline_start` or run-level `resume`.

Missing or empty `pipelineId` → `invalid_params`. A retiring (superseded) daemon rejects with `daemon_superseded`, matching other mutating pipeline RPC retirement, checked ahead of `branchKey` validation. A present `branchKey` that is not a string, or is blank after trimming, also → `invalid_params`; a non-blank `branchKey` (including one with surrounding whitespace) forwards unchanged to `resumePipeline`'s `options.branchKey`.

On derived `awaiting-approval`, the handler may claim ownership via `claimPipelineContinuation` but must not call `continuePipeline`. The gate row stays `awaiting` with no later dispatch. Missing persisted admission context → `missing_context`; `claimPipelineContinuation` refusal → `claim_refused`. `isPipelineContinuable` remains false for awaiting pipelines, and startup `recoverContinuablePipelines` does not auto-activate them — awaiting resume is explicit-only.

Unscoped and explicit-`default` admission also continues a reachable `approved` gate's undispatched pending workflow successor via `continuePipeline` scoped to that lane, without `reopenFailedPipeline` and without reopening or mis-scoping to an unreopened failed sibling — not when aggregate derived state is `awaiting-approval` or `running` (mixed fan-out with siblings still awaiting or running uses branch-scoped resume). Named-lane admission classifies the same approved-gate pending strand in `resolveBranchResumeAdmission` and continues without reopen when no replayable `failed` row sits on that branch.

On derived `failed`, the handler applies `reopenFailedPipeline` when a `failed` row remains and no approved-gate pending strand took the admission path above, returns the admission outcome, and detaches `continuePipeline` from persisted admission context when reopen applies. Already-reopened failures (`reopenedFailurePermitsActivation` true, derived `pending`) skip reopen and continue only the eligible failed stage; every predecessor `workflowInvocationId` and artifact stays unchanged.

Terminal refusal without dispatch: derived `succeeded` → `pipeline_terminal_succeeded`; derived `rejected` → `pipeline_terminal_rejected`. Deferred-state refusal without dispatch: derived `running` (except the deferred-settlement wedge below), fresh `pending` without reopen or approved-gate pending strand, or `interrupted` → `pipeline_not_resumable`. When `reopenFailedPipeline` refuses an ineligible failed shape, the store reason propagates unchanged (`no_failed_stage`, `multiple_failed_stages`, `malformed_continuation`, `reopen_lost`, etc.).

One exception carves out of the derived-`running` refusal: `resumeDrivesDeferredSettlement` admits resume when a stage row is wedged `settlement_deferred`/`entry_run_still_live` and its linked entry run is durably terminal (`hasRedrivableDeferredSettlement` with no reconciled-entry-run exclusion, since resume runs on a live daemon rather than a restart batch). Admission drives straight to `continueAfterAdmission` → `continuePipeline` — no reopen, since the wedged row is `running`, not `failed` — settling the stage, dispatching its successor, and running terminal publication exactly as the restart-sweep re-drive does. The exception is scoped to derived `running` only: a derived-`interrupted` pipeline carrying the same wedge still refuses `pipeline_not_resumable`, because any `interrupted` sibling stage row wins in `derivePipelineState` ahead of the wedge check. A genuinely live linked entry run also still refuses. The handler's outcome and detachment are unchanged by this path — `{ kind: "resumed", pipelineId }`, settlement continues detached as usual, so the operator confirms the settled outcome via `pipeline list` / `pipeline wait` rather than the RPC return.

Resume- and sweep-driven deferred settlement reload the linked entry run before building a successful stage artifact, preserving its complete `prNumber`/`prUrl` pair. For the authored-order final workflow stage of a `ready` or `merge` pipeline, a completed entry run missing either field instead settles the stage `failed` with `failureDetail.code: "completion_publication_missing_pr_evidence"`; terminal publication is not invoked, so this does not become its generic `PR evidence required` failure.

The handler resolves after reopen and/or claim admission (or refusal), not after detached continuation finishes.

`resumePipeline` also accepts an optional `options.branchKey`, scoping admission to one named fan-out branch instead of the aggregate walk above. `pipeline_resume`'s wire `branchKey` param forwards straight through to this option after handler validation (see the table entry above). `branchKey: "default"` and omission are an exact alias of the unscoped path; a downstream branch literally named `default` is therefore unaddressable via branch scope, an aliasing collision inherited from `reopenFailedPipeline`'s own `"default"` handling.

A named `branchKey` bypasses `derivePipelineState` admission entirely — not only the reported `awaiting-approval` shape, but running, rejected, deferred, and terminal aggregate outcomes too. This is safe: a live named branch has no `failed` row of its own, so branch admission independently refuses `branch_not_resumable` before any reopen regardless of what a sibling branch is doing.

Branch admission derives its boundary the way `reopenFailedPipeline` does — the lowest durable position carrying both a `default` row and a `branchKey` row — then scans the named branch's own suffix in order: an absent branch (unknown key, empty/whitespace key, a pipeline with no fan-out split, or a durable-row gap from that boundary onward) refuses `branch_not_found`; the branch's own reachable undecided (`awaiting`) or `rejected` approval gate refuses `branch_awaiting_approval` / `branch_rejected` (each carrying the blocking gate's `stageId`); an approved-gate pending strand (`approved` gate with undispatched pending workflow successor) admits without reopen; otherwise a missing replayable `failed` row refuses `branch_not_resumable` (carrying the branch's current stage status, e.g. `running`). Every branch-scoped refusal carries the requested `branchKey`; propagated `reopenFailedPipeline` refusals (`no_failed_stage`, `multiple_failed_stages`, `malformed_continuation`, `reopen_lost`) carry it too.

An admitted branch with a replayable `failed` row calls `reopenFailedPipeline({ pipelineId, branchKey })` to reopen only that branch's own failed row and skipped suffix; an admitted approved-gate pending strand skips reopen. Both paths then call `continuePipeline(pipelineId, deps, branchKey)`: continuation still walks the shared `default` prefix from the start and still performs terminal-publication settlement exactly as unscoped continuation does — `branchKey` only scopes which branch's suffix dispatches. The success payload is unchanged (`{ kind: "resumed", pipelineId }`), matching the unscoped shape.

### Branch-scoped blocked plan-stage recovery

This "recovery" is the operator-requested `pipeline_recover` verb this section and [`pipeline_recover` RPC and detached admission](#pipeline_recover-rpc-and-detached-admission) describe — distinct from the unrelated, pre-existing "recover" naming elsewhere in this doc: `recoverContinuablePipelines` (`pipeline-execution.ts`, aliased here as `continueContinuablePipelines`) is restart reconciliation (see [Restart-safe pipeline continuation](#restart-safe-pipeline-continuation)) and never invokes this seam or auto-recovers a blocked stage — only an explicit `pipeline_recover` RPC does.

`v2/src/daemon/pipeline-stage-recovery.ts`'s `resolveBlockedPlanStageRecoveryTarget({ pipelineId, branchKey }, { store, resolveStage? })` resolves a branch's *blocked* (`failed`) plan stage into a recovery target for `recoverPlanStage` (see [`workflow-runner.md` § Plan-stage recovery](./workflow-runner.md#plan-stage-recovery)) — it never reopens, dispatches, claims, or writes anything itself. The linked entry run must be recoverable: either a blocked plan-write row (`contract_miss`/`blocked`) or a completed write with a terminal failed review sibling on an admitted `OutcomeKind` in the same invocation; otherwise resolution refuses `stage_not_recoverable`. `branchKey: "default"` addresses unscoped rows and requires no fan-out split, unlike branch-scoped [`pipeline_resume`](#pipeline-stage-scoped-resume): a single-branch pipeline's blocked plan stage is recoverable through this path even though it has no fan-out split to admit branch-scoped resume.

Admission walks the branch's own durable rows for its authored `stageId`s (`findStageRecord`, reused from `pipeline-execution.ts`) to find the branch's single `failed` workflow stage row, and reads that row's retained `workflowInvocationId` as the linked entry run (`store.loadRun`) — never an operator-supplied run id. It then re-resolves that stage's steps through the same `resolveStage` dependency (default `resolveStageWorkflowSteps`) ordinary dispatch uses, with `stageArtifacts` built by `buildBranchStageArtifacts` (also reused from `pipeline-execution.ts`) exactly as a branch walk builds them, so re-resolution sees a splitting intent stage's `downstreamInputs`. For a named fan-out lane, recovery narrows the successful `{ results }` resolution by pairing `findFanOutSplit(...).branchKeys[index]` with `results[index]`, the same ordering ordinary fan-out dispatch uses; a missing paired result refuses instead of borrowing another lane. `branchKey: "default"` retains the single `{ steps }` path. Recovery drops only the selected result's leading write step and keeps its `review`/`review-debate` step; that step's `landing.durablePath` is overridden to the linked entry run's own recorded `specPath` — `buildPlanWorkflowSteps` stamps a fresh UTC timestamp into the durable spec dir on every resolution, so the freshly re-resolved path would land the corrected tree in a directory no stage artifact ever names.

Refusals (each with no target returned):

- `pipeline_not_found` — unknown `pipelineId`.
- `branch_not_found` — unknown or empty `branchKey`, or no durable row carries it.
- `no_failed_stage` — the branch carries no `failed` workflow stage row.
- `stage_not_plan` — the branch's failed row is an authored `workflow: "intent"` or `"implement"` stage, not `"plan"`.
- `stage_not_linked` — the failed row has no `workflowInvocationId`, or that run id no longer resolves to a run row.
- `missing_context` — the pipeline's durable `context` is `null`; checked before re-resolving steps, the same reason `continuePipeline`/`resumePipeline` refuse a context-less pipeline.
- `stage_resolution_failed` — `resolveStage` reports `{ ok: false }`, or its successful shape has no result paired with the requested lane (including a fan-out result-count/order mismatch or a fan-out/single shape mismatch). All other admission and attempt-time guards remain unchanged.
- `stage_not_recoverable` — the re-resolved steps carry no `review`/`review-debate` step with a `plan-tree` landing (a `review: "none"` plan stage lands on its write step, which recovery never re-runs), the resolved review step's `cwd` differs from the linked run's `worktreePath` (recovery revalidates `<worktreePath>/.jarvis-plan-stage` while the actuator edits `cwd`, so divergence would validate one tree and land another), or the linked entry run is not a recoverable blocked-write or review-failed plan stage.

The admitted target (`{ runId, project, branch, worktreePath, writeStepId, steps, stageId }`) carries the shape `PlanStageRecoveryRequest` (`workflow-runner.ts`) needs minus its `stateStore`/`logSink`/`completionCommitter`, plus the failed row's own `stageId` — a caller adds those and calls `recoverPlanStage`, whose own run-shaped admission (populated staging, blocked-write or review-failed write row, Git mode, blocker provenance, staged contract validity, and on the review-failed path no live worktree claim) still applies unchanged.

`recoverPipelineBranchStage({ pipelineId, branchKey }, deps)` (same file) is the execution entry point that runs the attempt, settles it, and advances only the target branch. `deps` layers `dispatch`/`wait` (the same ones `continuePipeline` takes), an optional `attempt` seam (default `recoverPlanStage`), and optional `logSink`/`completionCommitter` onto `resolveBlockedPlanStageRecoveryTarget`'s own deps:

1. **Resolve and capture.** Calls `resolveBlockedPlanStageRecoveryTarget` and, on refusal, returns `{ kind: "resolution_refused", reason, message }` with no further effect. On success it captures the target's `runId` (the entry run) and `stageId` from the resolution — not from a re-read of the row — since the attempt runs against this capture regardless of outcome and `reopenFailedPipeline` (on success) nulls the row's own `workflowInvocationId`.
2. **Claim.** Claims durable stage admission (`claimPipelineStageAdmission({ pipelineId, stageId, branchKey })`). A held claim refuses `{ kind: "stage_claimed" }` before the attempt, reopen, or relink ever run — the same `claim_lost` outcome ordinary dispatch's admission claim already returns, renamed at this call site. Operator disposition for a leaked claim (a crash mid-attempt) is the same manual `pipeline_stage_admission` row deletion a leaked ordinary-dispatch claim already requires; there is no stale-claim sweep.
3. **Attempt.** Runs the injected attempt (default `recoverPlanStage`) directly against the captured entry run and worktree — no row is mutated before this call, so the target row's `failed` status, `failureDetail`, and linkage stay exactly as resolution found them until the outcome is known. `recoverPlanStage`'s own admission (populated staging, `blocked` status, Git mode, an unremoved operator-authored `## Blocker`, staged contract validity) can still refuse here; a staged operator-authored `## Blocker` must be removed as part of the correction, since `recoverPlanStage` always refuses `operator_blocker`.
4. **Branch on the outcome.** Success is `outcome.ok && outcome.kind === "complete"` — not `outcome.ok` alone. `recoverPlanStage` also reports `ok: true` for a non-`complete` workflow result (e.g. another `contract_miss`) and for `kind: "completion_commit_failed"` (nothing committed in either case); both settle as failures, never `succeeded`.
   - **Success:** reopens the branch (`reopenFailedPipeline({ pipelineId, branchKey })` — the only primitive that clears the branch's `skipped` suffix and requires the `failed` row to still exist), relinks the reopened row `running` with the captured entry run id, then settles it `succeeded` with an artifact built by the same `stageArtifactFromEntryRun` helper (exported from `pipeline-stage-dispatch.ts`) ordinary settlement uses — from the entry run's own `specPath`, `downstreamInputs` (when present), `prNumber`, and `prUrl` (when present). A recovered plan run never opened a PR, so the artifact naturally omits `prNumber`/`prUrl`. A `reopenFailedPipeline` refusal here (e.g. a concurrent mutation of the row's shape) settles the still-`failed` target row in place with a `{ code: "reopen_refused", message }` `failureDetail` naming the refusal — the same way a stopped attempt settles below — and returns `{ kind: "reopen_refused", reason }`, without relinking. This disposition is a terminal dead end: the attempt already landed and committed the corrected tree, so `.jarvis-plan-stage` is no longer populated and a further recovery attempt is refused by `recoverPlanStage`'s own populated-staging admission; an operator sees the reason on the row but cannot retry through this path. Settlement never reads `wait(entryRunId)`: a successful recovery leaves the write run `blocked` (recovery never re-enters the write step), so the shared entry-run rollup would settle the stage `failed` on every success.
   - **Anything else** (a refused attempt, a non-`complete` workflow result, or `completion_commit_failed`): settles the still-`failed` target row in place (`updateStage`, which patches by `(pipelineId, stageId, branchKey)` with no status precondition) with the attempt's own reason in `failureDetail`, never reopens, and leaves the row `failed` and admissible for another correction without a fresh resolution walk.
5. **Release.** The admission claim is always released once the attempt and any settlement finish, in both the success and failure paths.
6. **Continue.** Only a `succeeded` settlement continues the branch, via `continuePipeline(pipelineId, deps, branchKey)` — scoped to the target branch, so it moves that branch's own next reached row (e.g. its `approve-plan` gate to `awaiting`) and dispatches nothing further; sibling branches and their gates are untouched. A failed or refused settlement continues nothing.

Isolation: recovery only ever claims, reads, and writes rows for `(pipelineId, stageId, branchKey)` on the target branch (plus the branch-scoped continuation above); sibling branches' rows and gates are never read for mutation and stay byte-for-byte unchanged.

#### `pipeline_recover` RPC and detached admission

`admitAndRecoverPipelineBranchStage` (`pipeline-stage-recovery.ts`) still resolves, durably claims, and runs the attempt chain for direct callers and tests; the RPC handler instead validates, effect-free-resolves for `project`/`branch`, enters shared `admitWorkflowStart`, claims durable stage admission in its `admit` hook, and detaches `executeClaimedPipelineBranchStageRecovery` from `execute` with `onSettled` releasing common admission and the log. Attempt outcome stays on the stage row, not the RPC response.

### Pipeline snapshots

`pipeline_list` returns one durable enumeration of admitted pipelines without following live transitions:

```json
{ "pipelines": [{ "pipelineId", "name", "state", "terminalAction?", "seedPath?", "terminalPublicationSucceededAt", "terminalPublicationFailure", "createdAt", "finishedAtMs", "dismissedAt", "stages": [{ "id", "stageId", "branchKey", "position", "status", "workflowInvocationId", "startedAt", "endedAt", "decidedAt", "artifact", "failureDetail" }] }] }
```

`terminalAction` comes from the admitted definition. `seedPath` is copied unchanged from durable admission context, may remain relative to admission `cwd`, and does not expose `cwd`. Each is omitted when absent. The nullable `terminalPublicationSucceededAt` and `terminalPublicationFailure` fields are always present and mutually exclusive. Stage `artifact` and `failureDetail` preserve stored JSON exactly, including `null`, `false`, `0`, and `""`.

`createdAt` is the durable pipeline row admission timestamp (ms). `finishedAtMs` is `null` while derived `state` is non-terminal; for terminal states it is `terminalPublicationSucceededAt` when set, otherwise the maximum non-null stage `endedAt` or approval `decidedAt`, otherwise `createdAt`. Stage `startedAt`, `endedAt`, and approval `decidedAt` are milliseconds since epoch; `decidedAt` is the durable approval-decision time and is `null` before decision and on non-approval stages.

`dismissedAt` is the durable `dismissed_at` timestamp (ms), `null` when not dismissed, on every snapshot regardless of `includeDismissed`. By default `pipeline_list` filters out any pipeline with a non-null `dismissedAt`; the optional `includeDismissed` param, read as strict `=== true`, includes them. The store never filters on `dismissed_at` itself — `reconcilePipelines`, `claimPipelineContinuation`, `pipeline_resume`, `pipeline_recover`, and restart recovery all still see and can drive a dismissed pipeline; only this default listing hides it, until an operator undismisses it or opts into `includeDismissed`.

An empty store returns `{ "pipelines": [] }`. Stage snapshots preserve stored authored-position order and expose that durable `position` plus row `id` (then `branch_key` within each position); pipeline order is unspecified. The response promises no stronger cross-pipeline or concurrent-row isolation than that single `listPipelines` read — observation does not hold execution writes.

`pipeline-execution.ts`'s `derivePipelineState` computes each `state` from durable pipeline and stage rows only (no new column), walking stages in stored `position` order — the same ordering `runPipeline` and `loadPipeline` use. First match wins:

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

Stage satisfaction for the walk: workflow stages satisfy on `succeeded`; approval stages satisfy on `approved`. Any unsatisfied approval row (for example `awaiting` or `pending`) is undecided; `rejected` is handled at step 2. `skipped` rows are never satisfied and are never reached because `failed` always precedes them. After reconcile, operators see `awaiting-approval`, `pending`, or `rejected` from untouched stage rows even while the pipeline row still reads `interrupted`; `claimPipelineContinuation` restores `active` when continuation claims ownership.

Terminal states: `succeeded`, `failed`, `rejected`, `interrupted`. Non-terminal: `pending`, `running`, `awaiting-approval`. Callers must not infer terminality from raw stage vocabulary alone.

After the ordered stage walk completes with every authored stage satisfied and no early `stop`, `runPipeline` invokes `executeTerminalPublication` when the admitted definition carries `terminalAction`. Executor input resolves from the authored-order last succeeded workflow stage artifact (`prNumber`, `prUrl` from the stage artifact; `worktreePath`, `branch`, `baseRef` from `store.loadRun(artifact.entryRunId)`). Successful stage settlement copies the fresh entry-run PR pair into that artifact; for `ready`/`merge`, missing completion-publication evidence during deferred settlement fails the final workflow stage before this invocation. Success stamps `terminal_publication_succeeded_at`; failure records `terminal_publication_failure` without rewriting stage rows. `continuePipeline` and `recoverContinuablePipelines` idempotently finish pending settlement when stages are satisfied but the success marker is absent. Terminal-publication failure is non-resumable via `pipeline_resume` / `reopenFailedPipeline` in this slice.

### Pipeline wait

`pipeline_wait { pipelineId }` blocks until the named pipeline reaches a wait boundary, or the request `AbortSignal` aborts. It reads durable pipeline and stage rows before blocking and returns immediately when the pipeline is already at a boundary — a new transition after subscription is not required.

Wait boundaries:

```json
{ "kind": "terminal", "state": "succeeded" | "failed" | "rejected" | "interrupted" }
{ "kind": "awaiting-approval", "stageId": "<first undecided approval after satisfied predecessors>", "branchKey": "<blocking gate row branchKey>" }
```

`pending` and `running` are not boundaries unless an approval gate row with satisfied branch-suffix predecessors reads `awaiting` or `pending`; a live wait returns that `awaiting-approval` envelope even when a sibling branch workflow stage is `running`. Otherwise a live wait keeps observing through workflow-stage transitions until the first durable terminal or `awaiting-approval` boundary. Boundary derivation walks durable stage rows in `loadPipeline` order for the first unsatisfied approval row after satisfied predecessors within that row's branch suffix. On fan-out pipelines, terminal `failed`/`rejected` boundaries apply only after no actionable sibling work remains; until then a reachable `awaiting-approval` boundary may surface even when another branch settled unsuccessfully.

Observation substrate: re-read durable pipeline/stage rows after each in-process `updateStage` (via an in-daemon observer) and on bounded polling (`FOLLOW_POLL_MS`, same default as log follow) until `AbortSignal`. No run-log follow and no implicit `pipeline_list` follow loop.

Refusals: missing or empty `pipelineId` → `invalid_params`; unknown durable ID → `unknown_pipeline` (no wait begins). Aborting a live wait throws `pipeline_wait aborted` at the handler boundary and does not return a boundary payload — same cancellation shape as run `wait`. Other wait-time failures propagate without conversion to abort.

## Library surface

`startIpcServer(socketPath, handlers?)` binds a Unix listener in-process (tests and daemon host). Custom RPC handlers override built-in `health`/`status` if provided. `connectIpcClient(socketPath)` is a thin test/caller helper. Frame encode/decode lives in `v2/src/ipc/`.
