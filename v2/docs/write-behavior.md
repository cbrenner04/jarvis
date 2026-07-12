# Write behavior

`jarvis write` runs a resumable write loop: repeatedly calls `executeWrite` until
work is done, blocked, or the budget runs out. See [`state-store.md`](./state-store.md)
for durable run state and resume mechanics.

On a successful standalone write, the terminal SQLite boundary is committed before
the runner publishes completion to the external worktree. Publication is one
retryable boundary comprising three operations in sequence: commit, then push+PR,
then PR body refresh. Ready finalization is a separate retryable boundary after
publication succeeds: ready gate, then draft→ready flip.

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
body; when no matching open PR exists, creates a new draft PR with title resolved
from the spec's `index.md` H1 heading (falling back to `jarvis: complete run` when
unresolvable) and body `Spec: <specPath>` against `baseRef`. For completion-publication retry,
the resolved title is retained durably so re-publication uses the original title even
when the spec's `index.md` cannot be re-read. Multiple open PRs on the same branch are
disambiguated by `baseRef` match; when multiple match the same base, the first is
reused; when none match, a new PR is created. When the branch has no origin or
push/PR operations are disabled, this phase is skipped. Every publication
subprocess (`gh auth status`, upstream detection, `git push`, `git rev-parse HEAD`,
`gh pr list`/`create`) is awaited in that order before body refresh begins.

**PR body refresh:** after the draft PR is ensured, the publisher rewrites its
body: regenerated `Spec: <specPath>` header, an optional caller-supplied summary
block (pre-rendered markdown; omitted when absent or blank), preserved content
between plain `<!-- jarvis:narrative:start -->` / `<!-- jarvis:narrative:end -->`
markers when present, and an attribution footer from `Jarvis-Agent` trailer(s) on
commits in
`baseRef..HEAD` whose first body line begins with `Spec:`. Under v2's single
completion commit, that selects the `jarvis: complete run` meta-commit. Footer
shape: one bullet per qualifying commit (`- <shortSha> <subject> — <label>`,
labels joined per commit; `unknown` when no trailer; excluded from summary),
blank line, then `Written by <labels> through Jarvis.` with first-seen dedup.
The summary sits after the `Spec:` line and before narrative markers or the footer
separator; it is rebuilt on every refresh (not read from the existing body).
Absent or blank summary ⇒ today's body shape (header, then narrative or footer
only). Direct `jarvis2 write` and daemon completion paths supply no summary.
Intent runs (`completionStep.intentOutput` set) re-derive a summary at every
publish from the landed durable dir: the workflow creation title when it is not
the generic `jarvis: complete run` fallback, then one `- <file>.md` bullet per
owned intent file (invocation ownership when recorded, else every `.md` in the
durable dir). Empty landed-file list ⇒ subject line only; generic fallback title
⇒ bullets only. Review-last intent workflows land before this derivation; both
intent branches use the same publish-site logic.
Spec-authoring runs (`completionStep.promptId === "plan.prompt.draft"`) re-derive
a summary at every publish from `<publication spec path>/index.md`: the H1 as a
`# …` line, then every subspec checklist line verbatim in index order (full list,
no truncation). H1 with no checklist items ⇒ H1 only; missing or H1-less
`index.md` ⇒ no summary (today's body shape).
Empty footer ⇒ header (+ summary and narrative when present) only, no `---`
separator. v1's
hash-verified generated-narrative path (`jarvis:narrative:generated-sha256:`) is
not ported. `gh pr view`/`edit` and attribution `git log` reads are awaited;
rejected attribution Git reads fail refresh (only intentional missing qualifying
commits yield an empty footer). Refresh failures reuse retryable `completion_commit_failed`; resume
re-edits the same PR. Post-completion ordering: push+PR → body refresh → ready
gate → draft→ready flip (gate/flip in a separate finalization boundary).

**Ready finalization:** after publication (including body refresh) succeeds, a
separate retryable boundary awaits (1) the ready gate in the completed run's
worktree, then (2) `gh pr ready <branch>`. The default gate command is `bun run
ready`; any non-zero exit is a gate failure (missing and red gate scripts are
not distinguished), reported as `ready gate failed (exit N): <stderr>`. The
gate runs unbounded. On green, the awaited flip calls `gh pr ready <branch>`
through the same bounded transient-retry
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
delay, retry-notice, and `gh`-readiness are each independently injectable async seams, so
publication tests exercise retries and failures without live git/`gh` calls or wall-clock
delay; every retry attempt is awaited. Missing binding attribution fails before git mutation. This boundary operates
directly in the existing external worktree and does not create locks.

Workflows suppress per-step commits and publish once after every step and hidden shrink
completes, attributed to the final contributor. The publication and finalization
boundaries match standalone runs: commit once, then push+PR and body refresh once,
then ready gate and draft→ready flip once.

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

## Review cycle

The standalone review cycle invokes the caller-supplied read-only `critic`,
then the `actuator` when the critic's verdict is non-empty. The verdict is
written verbatim to the caller-supplied `verdictPath` and passed unchanged as
the actuator's entire prompt. Read-only critic operation is a caller binding
obligation; this executor does not add a sandbox.

Before each critic invocation, `verdictPath` is cleared. A verdict that is
empty after trimming ends successfully without invoking the actuator. A
non-empty verdict continues until `maxCycles`; zero runs no work. `maxCycles`
must be a finite non-negative integer and is validated before filesystem or
invocation work. Each critic start creates one cycle result, including role
failures. Invalidation or verdict-write errors are `invocation_failure` with
failure kind `error` and consume no cycle for invalidation failure. Critic or
actuator binding failure, including aborts represented by the binding's
terminal `error`, stops later work and identifies the failed role. A verdict
written before an actuator failure remains current.

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

Programmatic workflow dispatch for this cycle is documented in
[`workflow-runner.md`](./workflow-runner.md#review-dispatch).

## Plan write-step seeding and completion contract

The `plan` preset's single write step executes with runtime seeding and prompt
rendering to prepare the draft phase:

**Intent.md seeding:** Before the agent runs, the write step creates the
timestamped spec directory (`<targetDir>/<UTC-timestamp>-<name>/`) inside the
worktree and seeds `intent.md` from the `intentSeed` content (the ready-intent
verbatim, with frontmatter preserved). The intent is the sole durable
artifact passed to the draft agent.

**Placeholder supply:** The write step supplies four required `plan.prompt.draft`
placeholders:
- `WORKDIR`: the worktree root
- `NAME`: the timestamped spec-directory basename (e.g., `2026-07-11T09-47-44Z-plan-workflow-draft`)
- `INTENT`: the seeded ready-intent content (same as written to `intent.md`)
- `SPEC_GUIDANCE`: the jarvis-bundled spec-guidance document from `v1/docs/spec-guidance.md`

All four placeholders are mandatory; a missing placeholder fails the render.

**Output path rewrite:** After rendering, the prompt's literal `spec/<NAME>/`
output-path directive is rewritten to `<targetDir>/<NAME>/` so the agent writes
to the actual spec directory, not a placeholder pattern. This parity with v1's
draft behavior ensures the agent and the contract inspector read and write the
same durable path. For example, if `targetDir` is `v2/spec` and `NAME` is
`2026-07-11T09-47-44Z-plan-workflow-draft`, the agent writes to
`v2/spec/2026-07-11T09-47-44Z-plan-workflow-draft/`.

**Prerequisite blocker gate:** Before the shape contract is checked, the write
step compares the agent-written `intent.md` against the seeded `intentBefore`
baseline (captured from the ready-intent at workflow start). A genuine blocker
is exactly that baseline plus an appended `## Blocker` section, with frontmatter
immutable and no other modifications. When a genuine blocker is detected, the
workflow fails with `contract_miss` outcome and `plan.draft.blocker` failure
reason, without opening a draft PR. This terminal failure is distinct from shape
failures and ensures the workflow treats an agent-appended blocker as a complete
prerequisite failure.

**Draft output shape contract:** After the blocker gate passes (or no blocker is
appended), an injectable completion validator checks the draft output is a
runnable spec tree: `index.md` must exist and at least one file matching
`/^\d{2}-.*\.md$/` (a subspec) must be present in the spec directory. A bare
`index.md` with no subspecs fails. When this contract passes, the existing
commit + draft-PR completion publish proceeds unchanged. When it fails, the
workflow stops with `contract_miss` outcome and opens no draft PR. The failure
reason `plan.draft.shape` is carried as a distinct field in the contract-miss
result (distinct from the contract `id`), preserving the distinction between
blocker detection failures and shape failures.

## Intent review cycle

Intent review is a specialized read-only-critic / write-actuator cycle that
operates on staged ready-intent artifacts in `.jarvis-intent-stage/`. This
distinguishes it from generic review's verdict-only actuator prompt.

The intent-owned `intent.prompt.review` critic reads the staged intent artifact
and emits a verdict using governed context about intent quality standards (clear
prerequisites, properly scoped acceptance criteria, load-bearing decisions).
The intent-owned `intent.prompt.review-actuator` receives the staged intent,
spec guidance, and the unchanged critic verdict in an enforced delimited data
slot, then applies refinements to the staged intent file in place.

Critic role is read-only on the staged intent; actuator role may write only
within the `.jarvis-intent-stage/` directory. Both roles carry explicit
worktree-boundary and directory-scope obligations stated in their governed
prompts. The verdict is written to a reserved `.jarvis-intent-review-verdict.md`
sibling of the staging directory before actuator invocation.

**Enforcement isolation:** When part of a workflow, intent review enforces role
filesystem boundaries at runtime:

- **Critic read-only:** After each critic invocation, the working tree is
  checked for unauthorized changes outside the reserved verdict file. Any
  changes are detected, the worktree is restored to its prior state, and review
  fails. This ensures the critic cannot modify staged intents or other worktree
  files.

- **Actuator staging-only:** After each actuator invocation (when the verdict is
  non-empty), the working tree is checked to ensure all changes are within
  `.jarvis-intent-stage/`. Any changes outside the staging directory are
  detected and review fails. This prevents the actuator from modifying files
  outside its intended scope.

**Verdict lifecycle:** The `.jarvis-intent-review-verdict.md` file is reserved
by the review cycle and managed by enforcement:

- Pre-existing non-empty verdict files indicate a prior invocation owns them;
  review fails without starting.
- The verdict file is excluded from intent validation and landing; it is never
  copied to the durable ready-intents output directory.
- After successful review and landing, the verdict file is deleted.
- On landing failure, the verdict file remains for diagnostics and troubleshooting.

**Landing and final validation:** After successful review (all bounded cycles
complete), the enforcement layer runs final intent validation and landing as a
single atomic step:

- The verdict file is excluded from the staged output before validation.
- Staged intent files are validated identically to a standalone write-step
  intent output (artifact contract, well-formedness).
- Valid intents are landed transactionally to the durable `ready-intents/`
  directory (same transactional semantics as standalone intent landing).
- The verdict file is deleted after successful landing.

On landing failure (collision, validation error, or I/O failure), the review
returns failure with `resumable: true`. The verdict file remains. Resume retries
landing without re-running critic or actuator, preserving the reviewed output.

Unlike generic review's reusable verdict-only actuator, intent review's composed
actuator prompt carries the stage-boundary contract inline, rules out worktree-wide
mutation, and passes the unchanged verdict byte-for-byte via a delimited data
zone — enabling the enforcement mechanisms in this section.

## Plan light review cycle

Plan light review is a specialized read-only-critic / write-actuator cycle over the
materialized post-draft spec tree. Generic `review` forwards only a verdict to its
actuator; plan light review renders `plan.prompt.review.critic` and
`plan.prompt.review-actuator` against the built worktree state: spec files under
`<spec-dir>/`, seeded `intent.md`, jarvis-bundled spec guidance, and the critic's
stdout verdict. Builder-time metadata is not part of the live render context.

Review `cwd` and `<spec-dir>/verdict-plan.md` resolve from the draft step's
published worktree and timestamped spec directory. The executor clears
`verdict-plan.md` before each critic invocation, writes the critic stdout verbatim
on success, and skips the actuator when the trimmed verdict is empty.

**Role boundary:** the critic is advisory-only. After each critic invocation the
executor snapshots the worktree and fails the cycle when any filesystem change
occurred; unauthorized edits are restored before the actuator runs. The actuator
is the sole mutator of the spec tree. Actuator prompts carry the unchanged verdict
plus the same materialized draft context as the critic.

Workflow dispatch for the `plan-reviewed-light` preset supplies `planReviewContext` on the
loaded review step; see [`workflow-runner.md`](./workflow-runner.md#review-dispatch).

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

`jarvis run wait` renders a timed-out loop as `loopOutcomeKind:
"iteration_timeout"` with failed run status; it is not rendered as
`run_execution_failed`.

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
| `jarvis run workflow <name> ...` | Selects a registered workflow builder by name. Only `implement` is registered. Required flags: `--base` and `--spec`. Optional flags: `--branch` (defaults to parent directory basename of resolved `--spec`), `--artifact` (required for non-index specs, ignored for index specs), `--review-passes <n>` (non-negative integer; overrides the registered project's `implement.reviewPasses`, default `0`). A relative `--spec` is resolved from invocation cwd before project lookup; project is resolved from the registered project containing the resolved spec path (not from invocation cwd). Spec and artifact paths passed to the workflow are worktree-relative. The `implement` builder supplies `role`/`promptId`/`agents`/`agentModelConfig` and sends one IPC `start` request carrying `{ steps }` | Run ID | `0` on success; `1` on missing/unknown name, invalid flags, spec outside registered projects, invalid `implement.reviewPasses` project config, or machine-config validation failure — selection, parsing, project resolution, effective review-count resolution, and builder errors occur before daemon connection |
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
write loop completed and one hidden shrink write loop also completed when routing
completed work. A positive `reviewPasses` count appends one bounded
`review-debate` step after terminal shrink; `reviewPasses: 0` omits that step.
When review runs, `complete` additionally requires the debate step to finish
without `invocation_failure`. The hidden shrink pass uses the same worktree/spec/artifact context and agent order,
but resolves model rungs with `role: "shrink"` and records telemetry with
`role: "shrink"`. It is skipped for `budget-exhausted`, `paused`, `blocked`,
`contract_miss`, and `invocation_failure`. If shrink stops non-`complete`,
`wait` reports that outcome at the implement workflow step.

**Implement launch path preflight:** Before daemon contact or worktree creation,
the CLI resolves the registered project root and effective spec/artifact paths
through symlinks. The spec must exist and resolve inside that root. An `index.md`
launch uses that resolved spec as its artifact and ignores `--artifact`; a
non-index launch requires an existing explicit artifact resolving inside the same
root. Missing or escaping paths fail locally with a spec or artifact error. The
workflow stores both validated paths relative to the resolved source root, then
uses them inside the branch worktree; a first launch never reads the not-yet-made
worktree.

**Implement routing to linked subspecs:** When `jarvis run workflow implement`
is launched with a multi-subspec `index.md`, the harness routes each write-loop
iteration to the first unchecked linked subspec in the index. The active linked
subspec's path and body are injected into the prompt; agent iterations execute
that subspec rather than the index. Routing state is protected: agent-authored
changes to index checkboxes are detected, restored, and reported as
`implement.index_routing_mutated` without advancing routing; agent edits to the
active subspec's acceptance criteria remain allowed. Harness-only advancement
occurs when all non-human-only criteria in the active subspec are complete;
unchecked human-only criteria do not block routing advancement. After the final
linked subspec completes, shrink runs once. Direct subspec input (non-index
`--spec`) fails with `implement.requires_index`; empty or already-complete
indexes return complete without implement or shrink invocation. Invalid linked
paths (malformed, missing, unreadable, out-of-tree) fail before agent
invocation with named diagnostics: `implement.malformed_link`,
`implement.link_missing`, `implement.link_unreadable`, or
`implement.link_out_of_tree`.

**Optional implement debate review:** `--review-passes <n>` (or project
`implement.reviewPasses`) appends one `review-debate` step after terminal
shrink. The step runs in the implement worktree, renders `patch.prompt.review.*`
per cycle, writes `verdict-patch.md` beside the executed index (overwritten each
cycle), and commits actuator edits through the same completion committer as
implement write edits. Empty or already-complete indexes, and any non-`complete`
implement or shrink outcome, skip the review without hard-fail.

**Workflow-started implement live control:** Implement runs launched via `jarvis run workflow implement` cannot be paused, resumed, or killed via `jarvis run pause/resume/kill`. The workflow step executes atomically to completion within the step's timeout; partial progress cannot be saved. Only `jarvis run start ...` implement runs (direct `write` mode) support live control.

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
- `1`: `blocked`, `contract_miss`, `completion_commit_failed`, or `ready_finalize_failed`
- `2`: `invocation_failure` (binding chain or token parse failure)
- `5`: `budget-exhausted` (soft-stop, resumable per spec 02)

`completion_commit_failed` and `ready_finalize_failed` leave the durable run
`completed` with `resumable: true`; `jarvis run resume <run-id>` may retry without
creating a duplicate commit or PR.

### Wait exit codes

`jarvis run wait <run-id>` sends one IPC `wait` request and resolves once per
invocation boundary (quiescent edge), not full lifecycle join. Fleet scripts
needing lifecycle success should loop `wait` until exit `0` or inspect stdout
`runStatus` / `resumable`; non-zero exit does not imply non-resumable.

When `loopOutcomeKind` is present it wins over `runStatus`:

- `0`: `complete`
- `1`: `blocked`, `contract_miss`, `completion_commit_failed`, `ready_finalize_failed`, `paused`, `progress`, or any other present kind
- `2`: `invocation_failure`
- `5`: `budget-exhausted`

`completion_commit_failed` and `ready_finalize_failed` carry `runStatus: completed`
and `resumable: true` on stdout; exit `1` is retryable via `jarvis run resume`.

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
