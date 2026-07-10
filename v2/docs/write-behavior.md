# Write behavior

`jarvis write` runs a resumable write loop: repeatedly calls `executeWrite` until
work is done, blocked, or the budget runs out. See [`state-store.md`](./state-store.md)
for durable run state and resume mechanics.

On a successful standalone write, the terminal SQLite boundary is committed before
the runner publishes completion to the external worktree. Publication is one
retryable boundary comprising two operations in sequence: commit, then push+PR.

**Commit phase:** captures an isolated `git add -A` snapshot, creates one
`jarvis: complete run` commit with `Spec: <specPath>` and the final successful
binding's `Jarvis-Agent` trailer, then updates the branch by compare-and-swap.
Hooks are bypassed. A clean snapshot with a HEAD that predates this completion
(no `jarvis: complete run` commit) is a true no-op and returns no `commitSha`.
A clean snapshot whose HEAD *is* the completion commit — i.e. the commit landed
on a prior attempt but publication never confirmed success — reports that
existing `commitSha` again rather than no-op'ing, so resume re-attempts
publication instead of masking a failed publish as success.

**Push+PR phase:** (when commit succeeds, or resume finds an already-committed
HEAD) gates on a single injectable `gh` readiness probe (`gh auth status`;
nonzero exit, including a missing binary, is not-ready) before pushing to origin
with upstream detection: a branch without upstream tracking uses
`git push -u origin <branch>`; a tracked branch uses plain `git push`. PR lookup
follows: scans for open PRs on the current branch, filters by matching base ref
(the run's `baseRef`), and reuses the first match without mutating its title or
body; when no matching open PR exists, creates a new draft PR with title
`jarvis: complete run` and body `Spec: <specPath>` against `baseRef`. Multiple
open PRs on the same branch are disambiguated by `baseRef` match; when multiple
match the same base, the first is reused; when none match, a new PR is created.
When the branch has no origin or push/PR operations are disabled, this phase is skipped.

**PR body refresh:** after the draft PR is ensured, the publisher rewrites its
body: regenerated `Spec: <specPath>` header, preserved content between plain
`<!-- jarvis:narrative:start -->` / `<!-- jarvis:narrative:end -->` markers when
present, and an attribution footer from `Jarvis-Agent` trailer(s) on commits in
`baseRef..HEAD` whose first body line begins with `Spec:`. Under v2's single
completion commit, that selects the `jarvis: complete run` meta-commit. Footer
shape: one bullet per qualifying commit (`- <shortSha> <subject> — <label>`,
labels joined per commit; `unknown` when no trailer; excluded from summary),
blank line, then `Written by <labels> through Jarvis.` with first-seen dedup.
Empty footer ⇒ header (+ narrative if present) only, no `---` separator. v1's
hash-verified generated-narrative path (`jarvis:narrative:generated-sha256:`) is
not ported. Refresh failures reuse retryable `completion_commit_failed`; resume
re-edits the same PR. Post-completion ordering: push+PR → body refresh → ready
gate → draft→ready flip (gate/flip in a separate finalization boundary).

**Ready finalization:** after publication (including body refresh) succeeds, a
separate retryable boundary runs while the PR remains draft: (1) the ready gate
in the completed run's worktree, then (2) `gh pr ready <branch>`. The default
gate command is `bun run ready`; any non-zero exit is a gate failure (missing
and red gate scripts are not distinguished). The gate runs unbounded. On green,
the flip calls `gh pr ready <branch>` through the same bounded transient-retry
seam as publication (3 total attempts, flat 1000 ms backoff). Before the
transient classifier, the flip treats exit-0 (including empty output), and any
thrown `gh` error whose combined stdout+stderr contains (case-insensitive)
`already ready` or `not a draft`, as success without retry. Any other thrown
error is handed to the transient classifier unchanged. Gate or flip failure
(except the success-guarded flip cases) leaves the PR draft, keeps the durable
run `completed`, and returns retryable `ready_finalize_failed` (`nextAction:
resume`), distinct from publication's `completion_commit_failed`. Resume
replays publication first (idempotent), then re-runs the gate and re-attempts
the flip. Gate and `gh` are injectable seams so tests require no live
verification or GitHub credentials.

Publication failures (commit, push, PR, or body refresh) leave the durable run `completed`, expose
retryable `completion_commit_failed`, and return exit `1`; `jarvis run resume <run-id>`
may retry without creating a duplicate commit or PR. Non-fast-forward push rejection
is permanent (no retry). Transient network failures (push, PR lookup, PR creation, body refresh) retry
to 3 total attempts with flat 1000 ms backoff between re-attempts and emit
`<op>: transient network error; retrying (attempt <n>/3)` to stderr. Subprocess, backoff
delay, retry-notice, and `gh`-readiness are each independently injectable seams, so
publication tests exercise retries and failures without live git/`gh` calls or wall-clock
delay. Missing binding attribution fails before git mutation. This boundary operates
directly in the existing external worktree and does not create locks.

Workflows suppress per-step commits and publish once after every step and hidden shrink
completes, attributed to the final contributor. The publication boundary is identical
to standalone runs: commit once, then push+PR once.

The captured snapshot is the retry identity: later operator edits are excluded.

Workflow-step authoring that wraps this write-loop input shape lives in
[`workflow-runner.md`](./workflow-runner.md#authoring-helper-and-presets).

`jarvis daemon` and `jarvis run` expose the same write-loop surface through the
daemon IPC host. Transport and lifecycle wire contracts stay in
[`daemon-host.md`](./daemon-host.md); this doc owns the operator CLI.

Pause, kill, and crash-recovery branch on how the loop stopped: the loop never
resumes mid-step. Resume branches from durable state at the last committed boundary:

- Run `status = "paused"`: the prior invocation paused gracefully after committing
  the last attempt's boundary, so the loop starts a fresh attempt and continues.
  Pause is a separate `pauseSignal` (AbortSignal) input checked only at the
  iteration boundary after each step completes (distinct from kill-abort, which
  interrupts immediately).
- Last attempt still `in-progress`: the prior invocation died mid-step (kill/crash),
  so the loop re-runs that same iteration over the existing dirty worktree.
- Run `status = "budget-soft-stopped"`: the prior invocation hit its
  per-invocation budget after a committed `progress` boundary, so the loop
  continues with a fresh budget.
- Run `status = "completed"` / `blocked` / `failed`: the last boundary already
  committed a terminal result, so re-invocation returns that durable result
  without creating a duplicate attempt or outcome.

Worktree reconstruction stays on the existing
[`withExternalWorktree`](../src/execution/external-worktree.ts) path: if the stored
worktree directory is gone, the next iteration materializes it again from the
durable branch pointer before running.

The write prompt injects the v2 restraint principles (`write.principles`) at
every iteration; see [`coding-standards.md`](./coding-standards.md) for the
canonical principle text and rationale.

Current scope: resolved Claude, Codex, and Cursor bindings spawn real agent
processes through [`shared-invocation.md`](./shared-invocation.md). The older
bare-agent `createAgentBindings` helper still returns terminal-`error` bindings,
so any path still using it reports `invocation_failure` with
`failureKind: "error"` and exits `2`. The control flow (loop, contract dispatch,
outcome routing, state persistence, and resume) is exercised end-to-end in tests
by injecting simulated bindings (`v2/src/testing/bindings.ts`); no simulation
lives in the production CLI. `failureKind: "no_binding"` is exercised today only
via empty injected bindings in tests; live `createAgentBindings` always yields at
least one binding.

## Command

```
jarvis write \
  --project-root <repo-root> \
  --project <project-name> \
  --branch <branch-name> \
  --base <git-ref> \
  --spec <path-in-worktree> \
  --artifact <path-in-worktree> \
  [--max-iterations <n>]
```

## Daemon CLI

Daemon lifecycle commands use production defaults:

- Socket: `~/.jarvis/daemon.sock`
- PID file: `~/.jarvis/daemon.pid`

| Command | Output | Exit |
| --- | --- | --- |
| `jarvis daemon start` | Compact JSON `{"pid":<n>,"socketPath":"..."}` | `0` on success, `1` with `<ErrorName>: <message>` on lifecycle failure |
| `jarvis daemon stop` | `stopped` | `0` |
| `jarvis daemon status` | `running` or `stopped` | `0` when running, `1` when stopped |

`jarvis daemon status` probes the PID file and socket for lifecycle state. This is
distinct from the daemon IPC `status` RPC (`{ state: "running" }` host liveness),
which `jarvis tui` uses after `health` to prove the channel is live. See
[TUI CLI](#tui-cli).

## TUI CLI

Socket default: `~/.jarvis/daemon.sock` (same as daemon lifecycle commands).

Flow: connect → IPC `health` → IPC `status` → daemon `list` → interactive run
monitor. `jarvis tui` does not call `executeWriteLoop` locally and does not send
`start` or log-stream frames.

| Command | Output | Exit |
| --- | --- | --- |
| `jarvis tui` | Interactive ink run monitor; entry-time guard/RPC failure: ink `<code>: <message>`; connect-time unavailable: message naming `~/.jarvis/daemon.sock` and `jarvis daemon start` | `0` operator quit; `1` connect-time unavailable or entry-time guard/RPC failure before the monitor opens |
| `jarvis tui log <run-id>` | Interactive ink structured log follow over IPC tail; one line per record with `seq`, `kind`, and present per-kind fields (`attemptId`; `attemptId`/`outcomeKind`/`runStatus`; `loopOutcomeKind`/`iterationsConsumed`/`resumable`; kind only for `run_execution_failed`); connect-time unavailable: message naming `~/.jarvis/daemon.sock` and `jarvis daemon start`; mid-session tail failure: ink `daemon_error: <message>` | `0` operator quit or benign stream end; `1` connect-time unavailable, mid-session tail failure, or usage error |

On entry with a non-empty daemon `list`, the monitor selects the first row
(daemon order is newest-first), issues daemon `wait` for that `runId`, and shows
one row per run with `runId`, `project`, `branch`, `status`, and liveness
(`live` / `not-live`, matching `jarvis run list`). List-row `status` is the
poll-time value from `list` only.

On entry with an empty daemon `list`, the monitor shows an explicit empty state,
keeps no selection, and sends no `wait`.

The run list refreshes every second from daemon `list`, preserving selection by
`runId`. If the selected run disappears on a later poll, the monitor clears
selection and abandons the prior `wait` client-side. Mid-session refresh and
`wait` failures keep the last good monitor snapshot; operator quit still exits
`0`. Entry-time failures (connect unreachable, liveness proof, or initial `list`
before the monitor opens) exit `1` with the feedback above—not the
unavailable-daemon copy after liveness has been proved.

The outcome panel is sourced from daemon `wait`, not from `list`. While `wait`
is pending it shows an explicit pending state. Once the next invocation boundary
arrives it shows `runStatus` plus only present optional fields:
`loopOutcomeKind`, `iterationsConsumed`, and `resumable`. These fields are
resolve-time values from `wait`; the monitor does not infer them from list
polls. When `wait` fails for the unchanged selected run, the panel reverts to the
last ready snapshot when one exists, otherwise an explicit error state—not
perpetual pending. Selection changes abandon the prior `wait` client-side, start
a fresh `wait` for the newly selected run, and ignore any late reply from the
abandoned request.

Production ink selects the first list row on entry only; row navigation
keybindings are not wired yet—selection changes in tests use the injectable
view-host seam until navigation lands.

When the selected row includes workflow metadata, the monitor renders per-step
status from `list` only; single-step rows keep the prior layout. The outcome
panel still comes from `wait`.

The monitor exposes injectable `pauseSelected`, `resumeSelected`, and
`killSelected` (production keybindings deferred). Each maps 1:1 to daemon
`pause`, `resume`, and `kill` on the selected `runId`; no selection → no-op with
inline `no run selected`. No client pre-gate on liveness or terminal rows—daemon
and transport failures surface inline as `<code>: <message>` or
`daemon_error: <message>`; mid-session errors keep the monitor open. Steering
feedback replaces on the next action and clears on selection change;
`waitState` errors are unchanged. Successful `resume` re-issues `wait` and
abandons any prior ready snapshot; other successful actions keep the existing
refresh/`wait` loop. Success-feedback layout deferred until keybindings land.

Operator quit on the run monitor (`jarvis tui`) is `q` or Ctrl-C. Quit closes the
connected daemon RPC client and exits `0`.

`jarvis tui log <run-id>` opens an IPC tail stream on the production socket,
replays persisted records, follows live appends, and stays open after replay
until operator quit or benign server `stream-end`. It does not invoke run-control
RPCs or the connect-scaffold `health`/`status` path. Operator quit is `q` or
Ctrl-C; quit closes the tail stream client (sends `stream-end`) and exits `0`.

When the daemon is not reachable, start it with [`jarvis daemon start`](#daemon-cli)
before retrying `jarvis tui` or `jarvis tui log <run-id>`.

## Run control CLI

| Command | Input mapping | Output | Exit |
| --- | --- | --- | --- |
| `jarvis run start ...` | Same required flags as `jarvis write`; `--project-root`, `--project`, `--branch`, `--base`, `--spec`, `--artifact`, optional `--max-iterations`; mapped to the same `WriteLoopInput` fields and sent over IPC as one `start` request | Run ID | `0` on success |
| `jarvis run workflow implement ...` | Per-run only: `--branch`, `--base`, `--spec`, `--artifact`. Project comes from cwd (must match a project registered in `~/.jarvis/config.json`); `role`/`promptId`/`agents`/`agentModelConfig` come from the `implement` preset and machine config, not CLI flags. Built via `buildImplementWorkflowSteps` and sent over IPC as one `start` request carrying `{ steps }` | Run ID | `0` on success; `1` on missing/invalid flags, unresolved cwd, or machine-config validation failure — none of which contact the daemon |
| `jarvis run list` | None | One tab-separated row per run: `runId project branch status liveness reason retryable nextAction` — last three columns are `-` when daemon omits `error` | `0` on success |
| `jarvis run log <run-id>` | Run ID | One compact JSON line per persisted record; replay first, then follow new records until stream end or client close | `0` on stream end/client close |
| `jarvis run pause <run-id>` | Run ID | `paused <run-id>` | `0` on success |
| `jarvis run resume <run-id>` | Run ID | `resumed <run-id>` | `0` on success |
| `jarvis run kill <run-id>` | Run ID | `killed <run-id>` | `0` on success |
| `jarvis run wait <run-id>` | Run ID | One minified JSON line: `{runStatus, loopOutcomeKind?, iterationsConsumed?, resumable?, error?}` — only present optional fields included | See [wait exit codes](#wait-exit-codes) |

`jarvis run list` and `jarvis run wait` pass through daemon `error` fields
verbatim when present (`reason`, `retryable`, `nextAction`); see
[`daemon-host.md`](./daemon-host.md#operator-error-on-list-and-wait) for the wire
contract. Default output is actionable summary only — no stderr dumps or log
transcripts. List rows always emit eight columns; scripts that parsed the prior
five-column layout must migrate. Wait stdout includes `error` only when the daemon
result carries it (no `null` placeholder). Wait exit codes follow
`loopOutcomeKind` / `runStatus` only; `error` is informational stdout (e.g.
`retryable: true` with exit `4` on `killed`). TUI run views are unchanged in
this slice.

Run-control transport failures print the connection error to stderr and exit `1`.
Daemon RPC failures print `<code>: <message>` to stderr and exit `1`. The CLI
passes through daemon guards such as `invalid_params`, `unknown_run`,
`run_not_active`, `terminal_run`, `run_in_progress`, and `worktree_claimed`
without local reclassification.

- Worktree path: `~/.jarvis/worktrees/<project>/<branch>/`.
- Locking uses v1-compatible `.jarvis.lock` semantics, in a dedicated lock tree
  (`~/.jarvis/worktree-locks/<project>/<branch>/`) so the run serializes on the
  branch before its worktree exists.
- Resumable loop: `--max-iterations` is a per-invocation budget (default 10);
  no durable remaining-iterations counter. The loop consumes one iteration per
  `executeWrite` call.
- Agent fallback order comes from `~/.jarvis/config.json` `agents` when present,
  else `DEFAULT_WRITE_AGENTS` (`claude`); the chain advances only on `quota`.

For `jarvis run workflow implement`, `complete` means the authored implement
write loop completed and one hidden shrink write loop also completed. The
hidden shrink pass uses the same worktree/spec/artifact context and agent order,
but resolves model rungs with `role: "shrink"` and records telemetry with
`role: "shrink"`. It is skipped for `budget-exhausted`, `paused`, `blocked`,
`contract_miss`, and `invocation_failure`. If shrink stops non-`complete`,
`wait` reports that outcome at the implement workflow step.

## Loop outcomes

The loop classifies and routes results:

- **`progress`**: agent did useful work, not finished. Loop continues, consuming
  one of `N`. Contract is **not** checked mid-loop.
- **`done` / `no-work`**: agent claims finished. Loop checks `--artifact`
  existence (contract); pass → success (`complete`), fail → append `## Blocker`
  to the spec and stop (`contract_miss`).
- **`blocked`**: agent is blocked. Loop stops immediately (terminal `blocked`,
  distinct from `contract_miss`).
- **Budget exhausted** while still `progress`: loop exits with a soft-stop outcome
  (distinct from `blocked`, marked resumable). Re-invoking the same run resumes
  remaining spec work with a fresh per-invocation budget.
- **`invocation_failure`**: binding chain stopped without usable agent output, or
  token parse failed after a successful invocation. Foreground `jarvis write`
  stdout JSON uses `kind: "invocation_failure"` for both cases; see below.

### Binding-chain `invocation_failure` JSON

When the step result is binding-chain `invocation_failure`, stdout JSON includes:

- `failureKind` — `quota` | `model_config` | `error` | `no_binding` (see
  [`shared-invocation.md`](./shared-invocation.md))
- `bindingAttempts` — ordered `{ bindingId, resultKind }[]` summarizing each
  binding tried (`resultKind` is that attempt's `InvocationResult.kind`);
  production rung bindings use `agentId/adapterModel/priceKey`

`invalid_token` also maps to loop `kind: "invocation_failure"` but **omits**
`failureKind` and `bindingAttempts`. Other terminal outcomes (`complete`,
`blocked`, `contract_miss`, `budget-exhausted`) omit them too. Idempotent
re-entry returns persisted detail only when the terminal attempt row has
`invocation_failure_detail` stored; legacy rows without it resume detail-free.

Resume identity is `(project, branch, stepId)`. For single-step workflows (default, stepId omitted), resume identity is `(project, branch)` only: re-invoking the same project and
branch resumes the most recent durable run even if `--base`, `--spec`, or the
materialized worktree path differ. For multi-step workflows, stepId isolates each step's attempt history: each `stepId` within the same `(project, branch)` maintains independent resume state. A different project or branch creates a fresh
run.

## Review-debate cycle

`v2/src/execution/review-debate.ts` (`executeReviewDebate`) runs the fixed
per-cycle order `adversary` -> `advocate` -> `adjudicator` -> `actuator`; only
`actuator` writes. Each role goes through `executeWithQuotaFallback` against
caller-supplied bindings, same seam as write-step invocations.

- Default `maxCycles` is 1 (caller-supplied, no hidden convergence loop);
  `maxCycles <= 0` runs zero cycles (no invocations, no verdict write).
- The adjudicator's settled stdout is written verbatim to `verdictPath` each
  cycle, overwriting prior content.
- Empty (or whitespace-only) verdict skips the actuator for that cycle; the
  loop stops there rather than continuing to `maxCycles`.
- A `final: null` result from any role's `executeWithQuotaFallback` call
  aborts that cycle immediately (no later roles run) and is reported as a
  `role_failed` outcome; the loop stops.
- Telemetry follows the same `invocation_completed` shape and quota-fallback
  cardinality as write-step invocations (one row per binding subprocess in
  attempt order), with `role` set to the debate role name — see
  [`telemetry-capture.md`](./telemetry-capture.md).

## Exit codes

- `0`: `complete` (success)
- `1`: `blocked` or `contract_miss` (blocked on agent or spec)
- `2`: `invocation_failure` (binding chain or token parse failure)
- `5`: `budget-exhausted` (soft-stop, resumable per spec 02)

### Wait exit codes

`jarvis run wait <run-id>` sends one IPC `wait` request and resolves once per
invocation boundary (quiescent edge), not full lifecycle join. Fleet scripts
needing lifecycle success should loop `wait` until exit `0` or inspect stdout
`runStatus` / `resumable`; non-zero exit does not imply non-resumable.

When `loopOutcomeKind` is present it wins over `runStatus`:

- `0`: `complete`
- `1`: `blocked`, `contract_miss`, `paused`, `progress`, or any other present kind
- `2`: `invocation_failure`
- `5`: `budget-exhausted`

When `loopOutcomeKind` is omitted:

- `1`: other durable terminal `runStatus` (e.g. `completed`, `blocked`)
- `3`: `failed`
- `4`: `killed`
- `5`: `budget-soft-stopped`

Malformed success payloads exit `1` with `invalid daemon response` on stderr; other errors follow run-control rules above.

## Verification

Drive the path through the test seam:

- `bun test v2/src/execution/write-loop.test.ts` proves the loop: repeated iterations,
  outcome routing, contract checks, blocker appending, state persistence, and
  cancellation via `AbortSignal`.
- `bun test v2/src/cli.test.ts` proves foreground `write`, daemon lifecycle
  commands, run-control success/error paths, log JSONL streaming, `jarvis run wait`
  (blocking resolve, exit mapping, error pass-through), `jarvis tui` dispatch, and
  `jarvis tui log <run-id>` dispatch.
- `bun test v2/src/tui/tui-entry.test.tsx` proves TUI run-monitor flow: liveness,
  initial list/empty states, refresh, selection changes, pending and late
  abandoned waits, steering success and daemon/connection error pass-through,
  resume re-wait, workflow-step refresh/selection, quit, and unavailable/RPC
  feedback with injectable daemon client, refresh scheduler, and view-host fakes.
- `bun test v2/src/tui/tui-monitor-lines.test.ts` proves workflow-step line rendering.
- `bun test v2/src/tui/tui-log-follow-entry.test.tsx` proves TUI log-follow replay,
  blocking-after-replay quit, server close, live append, empty tail,
  mid-session tail failure, unavailable daemon, ink render seam, and per-kind line
  projection with injectable tail client and view-host fakes.

A live `jarvis write ...` runs the full pipeline and reports
`"kind": "invocation_failure"` until process bindings land.
