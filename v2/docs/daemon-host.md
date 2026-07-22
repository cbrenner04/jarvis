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
(IPC tail consumer over the same socket), and daemon lifecycle commands pin
`~/.jarvis/daemon-<executable-tree-digest>.sock`
plus matching `.pid` and `.log` paths at the consumer layer. The executable
digest is resolved before IPC, so a legacy `daemon.sock` is neither probed nor
stopped; other callers still pass
explicit paths.

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
| `status` | `{ currentRevision?: string, currentExecutableDigest?: string }` | `{ state: "running", loadedRevision: string, loadedExecutableDigest: string, recovery: { pending: boolean, reconciled: number, resumed: number } }` | Daemon-host liveness only — not a dispatch compatibility gate. `loadedRevision` is the daemon's recorded Git HEAD and `loadedExecutableDigest` is the SHA-256 digest of tracked blobs under `v2/src/**`, `shared/**`, and repo manifests at daemon boot. `recovery` is pending until all startup admissions finish; then its stable counts name rows reconciled and successfully auto-resumed. Unsupported and failed admissions are not resumed. |
| `start` | `{ input: WriteLoopInput } \| { steps: AnyWorkflowStep[] }` | `{ runId: string }` | Exactly one of `input`/`steps`; both, neither, or an empty `steps` array is rejected `invalid_params`. `{ input }` spawns a write loop in the background, or persists it `queued` if memory headroom is unavailable; returns immediately with run ID either way (see [Admission guards](#admission-guards-for-start-and-resume)). Rejected `worktree_claimed` if an existing queued run holds the `(project, branch)` key, or if memory headroom is clear and the key is claimed by a live run. `{ steps }` dispatches to `executeWorkflow` with `freshDispatch: true`, creating new run rows for every step and minting a fresh `invocationId`; prior `completed` runs are not reused. A linked implement first materializes and validates its managed worktree; failure returns `worktree_materialization_failed` with that path and the Git or validation reason, before routing or a run row. Returns `{ runId }` for step 0 once its run row is durably created; the workflow then keeps running in the background. A `firstStep.workflowInvocationId` request whose prior run is non-terminal (`in-progress`, `paused`, `budget-soft-stopped`) and owned by another invocation is rejected `worktree_claimed` (intent ownership guard). Terminal prior runs (`completed`, `failed`, `blocked`, `killed`) do not block a fresh request, allowing new runs to start. Rejected `insufficient_memory` (not queued) if memory headroom is unavailable at call time. Other failures before step 0's run row exists (e.g. an invalid step shape) return an error rather than hanging, surfacing `executeWorkflow`'s thrown message as `invalid_params`. |
| `list` | — | `{ runs: Array<{runId, project, branch, status, isLive, loopOutcomeKind?, iterationsConsumed?, resumable?, error?, reviewPasses?, reviewBehavior?, workflow?, prNumber?, prUrl?}> }` | List durable runs merged with in-memory liveness; `isLive=true` only while the loop's Promise is executing. After spawn-boundary executor failure: `status: "failed"`, `isLive: false` (see [Spawn-boundary failure capture](#spawn-boundary-failure-capture)). Optional outcome fields; optional `error` on non-success terminals (see [Operator error on list and wait](#operator-error-on-list-and-wait)). Optional `prNumber` and `prUrl` when publication confirmed a PR. Workflow-backed rows may also carry authored per-step progress (see [Workflow snapshots on list rows](#workflow-snapshots-on-list-rows)). Implement workflow rows may also carry retained `reviewPasses` and `reviewBehavior` (see [Implement review selection on list rows](#implement-review-selection-on-list-rows)). For workflow entry rows (the returned run id from a `start { steps }` invocation), `status` reflects a rollup over all steps in the invocation: the first authored durable step's terminal-but-not-completed status, `killed` if an authored durable step has no row in a non-live invocation, or `completed` if all authored durable steps are completed; while the workflow is live, status is `in-progress` regardless of step row state. When a stopping sibling owns the terminal outcome, entry `loopOutcomeKind`, `iterationsConsumed`, and `error` come from that sibling, while `resumable` remains eligible only when the entry row itself can resume. Other step rows in that workflow report their own durable statuses. Terminal runs (`completed`, `failed`, `blocked`, `killed`) are bounded to the 50 newest by creation time; all other statuses are exempt and always returned. Step runs of a listed workflow invocation are retained with that invocation regardless of the bound. Retention filters the response only — durable rows are kept (see [Terminal run list retention](#terminal-run-list-retention)). |
| `pause` | `{ runId: string }` | `{ ok: true }` | Signal graceful pause for an active run. The run continues at the next iteration boundary (in-flight step is not aborted). Rejected `run_not_active` if run is unknown, not active, or is a workflow-started run (see [Live controls on workflow-started runs](#live-controls-on-workflow-started-runs)). |
| `kill` | `{ runId: string }` | `{ ok: true }` | Abort the run's signal immediately and record durable status `killed` when the row is not boundary-terminal (`completed`, `blocked`, `failed`). Leaves the worktree dirty. Rejected `run_not_active` if run is unknown, not active, or is a workflow-started run (see [Live controls on workflow-started runs](#live-controls-on-workflow-started-runs)). |
| `resume` | `{ runId: string }` | `{ ok: true }` | Resumes paused, budget-stopped, killed, or retryable-publication workflow write runs only after shared snapshot reconstruction. The matching persisted step must retain non-empty rules, artifact path, agents, model config, and resolvable bindings; the reconstructed input preserves step identity, workflow snapshot, and timeout. Missing or invalid context returns `resume_unsupported` before claim/spawn. Eligible publication retries are `completion_commit_failed`, `ready_gate_failed`, and `surviving_mutation_failed`; `ready_flip_failed` is a terminal non-resumable settlement and is rejected with `terminal_run`; `list` and `wait` expose the matching retryable reason with `nextAction: "resume"` or terminal reason with `nextAction: "stop"`. Ad-hoc stopped runs remain unsupported. |
| `wait` | `{ runId: string }` | `{ runStatus, loopOutcomeKind?, iterationsConsumed?, resumable?, error? }` | Long-running one-shot wait for the next invocation boundary. On a workflow entry, a hidden finalization row that owns the rollup failure supplies outcome fields and error detail; entry resumability remains tied to the entry row. Unsupported stopped write context returns `error: { reason: "unsupported_resume_context", retryable: false, nextAction: "stop" }` and forces `resumable: false`, even when the historical loop record was resumable. Otherwise behavior is unchanged; optional `error` matches `list` for the same run (see [Operator error on list and wait](#operator-error-on-list-and-wait)). |

Unknown `method` returns `error` correlated to the request `id` (connection
stays open).

Entry `list` uses the same outcome selection while retaining the workflow rollup status.

### Terminal run list retention

`list` returns at most the 50 newest terminal runs — statuses `completed`,
`failed`, `blocked`, and `killed` — ordered by `created_at` descending with
`rowid` as a tiebreak. All other statuses (`in-progress`, `queued`, `paused`,
`budget-soft-stopped`) are exempt: they are always
returned and do not consume retention slots.

When a workflow invocation has any retained run, every step run sharing that
invocation's `workflowSnapshot.invocationId` is retained too, including
terminal step runs older than the 50-newest terminal bound. Companion step runs
do not consume retention slots.

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
| `contract_miss` | `loopOutcomeKind: "contract_miss"` or attempt `outcome_kind: "contract_miss"` | `false` | `inspect_spec` |
| `invalid_token` | attempt `outcome_kind: "invalid_token"` | `true` | `resume` |
| `missing_blocker` | attempt `outcome_kind: "missing_blocker"` | `true` | `resume` |
| `quota_exhausted` | binding-chain `invocation_failure` + `failureKind: "quota"` | `false` | `retry_later` |
| `model_config` | binding-chain `invocation_failure` + `failureKind: "model_config"` | `false` | `fix_config` |
| `no_binding` | binding-chain `invocation_failure` + `failureKind: "no_binding"` | `false` | `fix_config` |
| `invocation_error` | binding-chain `invocation_failure` + `failureKind: "error"` or legacy null detail | `false` | `stop` |
| `iteration_timeout` | failed `loopOutcomeKind: "iteration_timeout"` | `false` | `stop` |
| `harness_failure` | terminal `run_execution_failed`, or `failed` without mappable attempt detail | `false` | `stop` |
| `unsupported_resume_context` | stopped or publication-retry write run whose snapshot cannot reconstruct an executable step | `false` | `stop` |
| `completion_commit_failed` | `loopOutcomeKind: "completion_commit_failed"` on a `failed` row | `true` | `resume` |
| `ready_gate_failed` | `loopOutcomeKind: "ready_gate_failed"` on a `failed` row | `true` | `resume` |
| `surviving_mutation_failed` | `loopOutcomeKind: "surviving_mutation_failed"` on a `failed` row | `true` | `resume` |
| `ready_flip_failed` | `loopOutcomeKind: "ready_flip_failed"` on a `completed` row | `false` | `stop` |

For `completion_commit_failed`, `ready_gate_failed`, and `ready_flip_failed`, `error.publicationFailure` on both `list` and `wait` contains the failed operation, message, exit code, and bounded labelled stdout/stderr tails from the terminal `loop_finished` row. `ready_flip_failed` is terminal non-resumable; `completion_commit_failed` and `ready_gate_failed` are retryable. For `surviving_mutation_failed`, `error` also carries `survivingMutation`, `survivingMutationSourceFile`, and `survivingMutationSourceLine` from the terminal `loop_finished` row. When `ready_flip_failed` occurs after the publisher returned a PR number, `error.prNumber` on `list` and `wait` identifies the PR for manual fixing; omitted when publication returned no PR.

A failed hidden shrink publication row remains `failed` and resumable; the workflow entry row rolls up to `failed` rather than `completed`.

**Omission:** `error` is absent on `in-progress` runs and on `completed` runs with
no operator-actionable stop.

**Composition:** `composeRunOperatorError` reads durable `loadRun` plus the chronologically
last terminal log record (`loop_finished` or `run_execution_failed` — whichever ended
the current quiescent state). `list` replays persisted logs per row via injected
`logReader` (no `follow`). When `logReader` is absent (tests), `list` composes
store-only and does not fail the RPC. `wait` and `list` share one composer and one
terminal-selection rule.

**Tie-break:** Attempt `outcome_kind: "invalid_token"` or `"missing_blocker"` wins over generic
`resumable_pause` when `runStatus: "paused"`. Durable `runStatus` wins for resumable terminals (`killed`, `paused`,
`budget-soft-stopped`). For `failed` / `blocked`, last-attempt store detail wins over
conflicting `loop_finished` (e.g. `runStatus: "failed"` + `loopOutcomeKind: "complete"`
resolves from attempt detail). When `runStatus` is `failed` or `blocked` with no
mappable attempt detail, resumable `loopOutcomeKind` values from stale logs
(`paused`, `budget-exhausted`, etc.) do not win — operators see a non-resumable stop
(typically `harness_failure`). Spawn-boundary failure on resume can demote
`budget-soft-stopped` to `failed`; after demotion, `error` follows `failed` rules
and does not regress to `resumable_budget` from an earlier budget `loop_finished`
when a later `run_execution_failed` is the selected terminal.

**`error.retryable` vs `wait.resumable`:** `error.retryable` is the
operator-action signal on the error contract. `wait.resumable` remains loop-log
legacy from `loop_finished`, except unsupported snapshot context forces it to
`false`; it may be absent on store-only quiescent resolves (e.g. `killed`
without persisted loop fields).

Malformed `error` fields reject the entire `list` / `wait` payload (strict
`daemon-wire` parsing).

### Workflow snapshots on list rows

Workflow-backed `list` rows may include:

```json
{
  "workflow": {
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
- `steps[]` stays in authored workflow order from the durable workflow snapshot
  stored on that run.
- Each step carries `stepId`, `role`, `status`, `attemptCount`, and optional
  `terminalOutcome`.
- `status` is closed: `pending | in_progress | completed | stopped`.
- `terminalOutcome` is present only for terminal steps:
  `completed -> "complete"` and
  `stopped -> "blocked" | "contract_miss" | "invocation_failure" | "budget-exhausted" | "paused" | "killed"`.
- `attemptCount` counts started durable attempts for that step, including an
  active in-progress attempt.
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
(`{ input }`) runs, `workflow` for runs started via `{ steps }`. Only a
`write-loop` entry carries the `abortController`/`pauseController` `pause`/`kill`
act on. Every step's run — not only step 0's, as the run row for each step is
durably created — gets a `workflow`-kind entry keyed by that step's `runId`. A
`pause`/`kill` naming any of those run IDs is rejected `run_not_active`, same
code as an absent/unknown run; real kill/pause plumbing for a running workflow
step is deferred to a future consumer.

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
`stream-end`. The `stream-open` payload carries `{ runId: string }` to identify
the run. The server replays the run's persisted log records in `seq` order, then
streams new appends as `stream-data` frames — one record per frame — until the
client closes with `stream-end` or the connection drops. Each record is a
`PersistedRecord` serialized as JSON in the `payload` field.

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

**CLI default:** The CLI pins `~/.jarvis/daemon-<executable-tree-digest>.log`
alongside matching socket and PID paths; other callers supply `logPath`
explicitly or omit it to discard.

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
Workflow-step queued inputs rebuild bindings from their persisted
`role`/`agents`/`agentModelConfig`; ad-hoc inputs keep bare agent-id binding
rehydration until they gain resolver context.
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

## Library surface

`startIpcServer(socketPath, handlers?)` binds a Unix listener in-process (tests
and daemon host). Custom RPC handlers override built-in `health`/`status` if
provided. `connectIpcClient(socketPath)` is a thin test/caller helper.
Frame encode/decode lives in `v2/src/ipc/`.
