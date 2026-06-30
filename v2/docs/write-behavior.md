# Write behavior

`jarvis write` runs a resumable write loop: repeatedly calls `executeWrite` until
work is done, blocked, or the budget runs out. See [`state-store.md`](./state-store.md)
for durable run state and resume mechanics.

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
[`withExternalWorktree`](../src/external-worktree.ts) path: if the stored
worktree directory is gone, the next iteration materializes it again from the
durable branch pointer before running.

The write prompt injects the v2 restraint principles (`write.principles`) at
every iteration; see [`coding-standards.md`](./coding-standards.md) for the
canonical principle text and rationale.

Current scope: real agent process spawning is not wired yet.
`createAgentBindings` (see
[`shared-invocation.md`](./shared-invocation.md)) returns terminal-`error`
bindings, so a live `jarvis write` reports `invocation_failure` with
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
  [--agents <csv>] \
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

Flow: connect → IPC `health` → IPC `status` → ink field collection → one IPC
`start`. Field contract matches [`jarvis run start`](#run-control-cli) (same required
flags as `jarvis write`; optional `--agents`, `--max-iterations`). Does not call
`executeWriteLoop` locally.

| Command | Output | Exit |
| --- | --- | --- |
| `jarvis tui` | Success: ink feedback with returned run ID; validation failure: ink field errors; guard/RPC failure: ink `<code>: <message>`; unavailable: message naming `~/.jarvis/daemon.sock` and `jarvis daemon start` | `0` success, `1` validation/guard/RPC/unavailable |

When the daemon is not reachable, start it with [`jarvis daemon start`](#daemon-cli)
before retrying `jarvis tui`.

## Run control CLI

| Command | Input mapping | Output | Exit |
| --- | --- | --- | --- |
| `jarvis run start ...` | Same required flags as `jarvis write`; `--project-root`, `--project`, `--branch`, `--base`, `--spec`, `--artifact`, optional `--agents`, `--max-iterations`; mapped to the same `WriteLoopInput` fields and sent over IPC as one `start` request | Run ID | `0` on success |
| `jarvis run list` | None | One tab-separated row per run: `runId project branch status liveness` | `0` on success |
| `jarvis run log <run-id>` | Run ID | One compact JSON line per persisted record; replay first, then follow new records until stream end or client close | `0` on stream end/client close |
| `jarvis run pause <run-id>` | Run ID | `paused <run-id>` | `0` on success |
| `jarvis run resume <run-id>` | Run ID | `resumed <run-id>` | `0` on success |
| `jarvis run kill <run-id>` | Run ID | `killed <run-id>` | `0` on success |
| `jarvis run wait <run-id>` | Run ID | One minified JSON line: `{runStatus, loopOutcomeKind?, iterationsConsumed?, resumable?}` — only present optional fields included | See [wait exit codes](#wait-exit-codes) |

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
- `--agents` is the ordered fallback list (default `claude`); the chain advances
  only on `quota`.

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
  binding tried (`resultKind` is that attempt's `InvocationResult.kind`)

`invalid_token` also maps to loop `kind: "invocation_failure"` but **omits**
`failureKind` and `bindingAttempts`. Other terminal outcomes (`complete`,
`blocked`, `contract_miss`, `budget-exhausted`) omit them too. Idempotent
re-entry returns persisted detail only when the terminal attempt row has
`invocation_failure_detail` stored; legacy rows without it resume detail-free.

Resume identity is `(project, branch)` only. Re-invoking the same project and
branch resumes the most recent durable run even if `--base`, `--spec`, or the
materialized worktree path differ. A different project or branch creates a fresh
run.

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

- `bun test v2/src/write-loop.test.ts` proves the loop: repeated iterations,
  outcome routing, contract checks, blocker appending, state persistence, and
  cancellation via `AbortSignal`.
- `bun test v2/src/cli.test.ts` proves foreground `write`, daemon lifecycle
  commands, run-control success/error paths, log JSONL streaming, `jarvis run wait`
  (blocking resolve, exit mapping, error pass-through), and `jarvis tui` dispatch.
- `bun test v2/src/tui-entry.test.tsx` proves TUI launch flow (liveness, field
  collection, IPC `start`, guard/validation/RPC/unavailable paths) with
  injectable client, field collector, and view-host fakes.

A live `jarvis write ...` runs the full pipeline and reports
`"kind": "invocation_failure"` until process bindings land.
