# Write behavior

## Top-level command help

`jarvis help [<command> [<subcommand>…]]` walks the command tree in
`v2/src/cli/command-tree.ts` to render command and subcommand discovery. Each
path renders its node's usage line (when present), followed by one
`name<TAB>argumentShape<TAB>description` line per registered flag on that node
(boolean flags use an empty `argumentShape`; value-taking flags use a placeholder
such as `<path>`), then one `name<TAB>summary` line per child subcommand; leaf
nodes print usage and flags alone. Flag lines use canonical long names in
declaration order; short aliases accepted by the parser (for example `-y` for
`--yes`) appear as their own flag line when the parser treats them as distinct
tokens. The `usage:` strings in `v2/src/cli/usage.ts` may still mention flags
until error-path usage rendering is shortened — structured flag lines are the
discovery surface for accepted options. The top-level registry in `v2/src/cli.ts` composes each entry from its tree node
plus a handler, so a command's name, summary, and usage have one home.

`--help` and `-h` are aliases for the same output: `main()` intercepts them
before dispatch and delegates to the `help` renderer. Only the exact tokens
`--help` and `-h` trigger the alias (not `--help=<value>` or bundled short
flags). The alias fires only when the first `-`-prefixed argv token is one of
those flags, so a later flag value or operand may contain `--help` without
rendering help. The help path is the leading run of non-`-` tokens before that
flag, truncated to the longest prefix that resolves in the command tree — for
example `jarvis tui log <run-id> --help` renders `help tui log`, and
`jarvis run workflow intent-reviewed --help` renders `help run workflow`.
When that run is non-empty but its first segment is not a tree node, behavior
matches `help` for the full run: stderr gets the unknown-segment error, stdout
stays empty, exit 1. Root `--help`/`-h` renders the same overview as bare
`jarvis help`, including the root node's missing usage line (pre-existing
`help` behavior).

A node without its own usage falls back to its nearest ancestor's usage line.
For example, `jarvis help run pause` and `jarvis help daemon start` print the
`run` and `daemon` usage lines, since neither subcommand has a dedicated one.

Unknown segments print `unknown command: <input>` to stderr, followed by
`did you mean <name>?` only when exactly one sibling is within Levenshtein
distance 2. The trailer is a backticked help path: at depth 0
``run `jarvis help` for available commands``; at depth ≥1
``run `jarvis help <path so far>` for available commands``. Stderr gets the
error; nothing reaches stdout; exit 1.

The tree structure is help and coverage data only — it does not gate dispatch.
Dispatchers keep their inline branch chains; a name added to the tree without
a corresponding dispatcher is caught by the dispatch-coverage tests in
`v2/src/cli.test.ts`, which walk the tree and drive every path through
`main()`. Legacy
workflow aliases (`intent-reviewed`, `plan-reviewed`, `plan-reviewed-light`)
remain dispatchable but absent from the tree, so `jarvis help run workflow
intent-reviewed` is an unknown segment.

## Completed-spec archival

Cleanup may archive a v2 spec only when every linked subspec (or the sole spec
file) has at least one non-human-only acceptance criterion and all such criteria
are checked. Index routing checkboxes and durable run status are not evidence of
completeness. Cleanup fails closed when matching open-PR or materialized-worktree
ownership inspection fails, or finds an open PR or another owner.

The operation renames the entire source tree into the same spec home's
`completed/` directory. It removes `ready-intents/<name>.md` only when its bytes
match archived `intent.md`; a different queued intent remains. A prune failure
rolls the archive rename back. Cleanup never mutates durable run rows.

For `jarvis cleanup`, workspace retirement precedes open-home stranded archival on apply.
Apply-time stranded ownership uses materialized worktrees after successful retirements in that
invocation. `--dry-run` stranded ownership for open-home specs excludes worktrees in the retire
preview set so stranded archive lines match apply for that slice when those owners are the only
blockers and apply actually removes those worktrees (same assumption as the post-retirement
materialized list); if a previewed retirement fails, dry-run can still list stranded archives
apply refuses. Other cleanup slices are not fully predictable from dry-run. Cleanup derives
the timestamped artifact identity from the retired run's recorded spec path, previews
the retirement, archive destination, and proven intent prune under `--dry-run`, and
prints a specific skip reason if the artifact stays at the root after retirement.

`jarvis write` runs a resumable write loop: repeatedly calls `executeWrite` until
work is done, blocked, or the budget runs out. See [`state-store.md`](./state-store.md)
for durable run state and resume mechanics.

Each iteration arms a **wall segment** (`iterationTimeoutMs`, default 10 minutes)
from `iteration_started`. Stdout/stderr progress during the `executeWrite`
invocation re-arms that segment so slow-but-emitting agents are not cut off at a
single flat budget. A **hard ceiling** (`iterationCeilingMs`, default 30 minutes
after machine-config resolution) counts elapsed time since `iteration_started`
without reset; continuous output cannot extend past it. Direct `jarvis write` and
workflow write steps always run under wall + ceiling once bounds are resolved at
dispatch or resume; optional `iterationCeilingMs` on `WriteLoopInput` is for
direct/test injection, not an unbounded production iteration.

A separate **idle-output budget** (`idleOutputMs`, resolved from machine config
`idleOutputTimeoutMs`, default 90 s; `0` disables) is passed to the invocation's
underlying binding. Unlike the wall segment, the idle budget fires on a lack of
*any* stdout/stderr — a silent agent settles `idle_output_timeout` well before the
wall could elapse, giving `run list`/`run wait` a distinct signal from a
genuinely-slow-but-emitting iteration. `idleOutputMs` is resolved once alongside
`iterationTimeoutMs`/`iterationCeilingMs` by `resolveWritePathIterationBounds` and
stamped onto every write-behavior step (and its persisted workflow-snapshot entry,
so a resumed step stays armed). With `idleOutputTimeoutMs: 0`, the bound is
omitted entirely — no idle watchdog is armed, and a silent iteration falls back to
the wall segment.

Wall-segment expiry and ceiling overrun both commit `iteration_timeout` with
failed run status; an idle-output firing commits `idle_output_timeout` with failed
run status instead, attributing the settled binding's agent, model, and the idle
bound that fired.

The token and blocker-text re-prompt invocations share the same `idleOutputMs`
budget as the primary step invocation: a re-prompt that goes silent settles
`idle_output_timeout`, not `invalid_token`/`missing_blocker`.

On resume, a snapshot step missing `iterationCeilingMs` falls back to the current
machine config's value, but a step missing `idleOutputMs` does not — the loader
already omits the key when `idleOutputTimeoutMs: 0` disabled the watchdog, so a
machine-config fallback would silently re-arm a run the operator explicitly disabled.

On a successful standalone write, the terminal SQLite boundary is committed before
the runner publishes completion to the external worktree. Publication is one
retryable boundary comprising three operations in sequence: commit, then push+PR,
then PR body refresh. Ready finalization is a separate retryable boundary after
publication succeeds: ready gate, then draft→ready flip.

**Commit phase:** captures an isolated `git add -A` snapshot, creates one
completion commit with the resolved spec title as subject, `Spec: <specPath>`,
and the final successful binding's `Jarvis-Agent` trailer, then updates the
branch by compare-and-swap. Hooks are bypassed. A clean snapshot with a HEAD
that predates this completion (no `Jarvis-Agent:` trailer) is a true no-op and
returns no `commitSha`. A clean snapshot whose HEAD *is* the completion commit
— i.e. the commit landed on a prior attempt but publication never confirmed
success — reports that existing `commitSha` again rather than no-op'ing, so
resume re-attempts publication instead of masking a failed publish as success.
After per-iteration commits, a clean worktree whose HEAD is only the last
iteration commit still receives a **distinct** terminal completion commit
(`forceDistinctCommit` on every terminal publication-boundary committer call — in-loop
`complete`, publish-resume, and post-ready-gate repair re-commit) so publish-resume and PR
attribution have a separate completion boundary SHA instead of reusing the last
iteration SHA. The spec title is resolved identically to the PR title: from the spec
`index.md` H1 heading (when readable and non-empty), falling back to the spec
directory basename.

When the committer returns no `commitSha` (a true no-op), the completion boundary
checks the worktree for uncommitted changes (`git status --porcelain`). If dirty, the
run records `completion_commit_failed` (resumable) and names the uncommitted paths in
`completionCommitError`; a clean worktree still records `complete`. This guarantees a
reported `complete` always implies a commit exists.

**Per-iteration commits (every settled main-loop result):** On every
git-backed loop — including workflow write steps, whose `publishCompletion:
false` gates only completion publication (push/PR/ready), not in-flight
committing — each settled main-loop iteration (`progress`, `complete`
`done`/`no-work`, `blocked`, `contract_miss`, `invalid_token`,
`missing_blocker`, `invocation_failure`, and `stall`/`idle_output_timeout`)
runs the same completion committer seam after the step settles and before its
SQLite boundary. This is a durability floor, not just a `progress` cadence: a
single-iteration `done` (or any other settled terminal result) checkpoints its
git state before `boundary_committed` the same as a mid-loop `progress` step,
so a crash after the SQLite boundary never strands uncommitted agent edits.
A `contract_miss` harness-appended blocker is written to the spec file before
this checkpoint runs, so it lands in the same checkpointed tree. Ready-gate
repair iterations (`runReadyRepairIteration`) are excluded from this floor —
they keep their existing publish/recommit behavior, not a per-iteration
checkpoint. A worktree with no `.git` directory — typically `worktree.git:
false` steps pointed at a non-repo staging dir — is skipped the same as
before; the guard is on `.git` presence, not on the `git: false` flag itself.
The committer no-ops when the isolated index tree matches `HEAD^{tree}`
(reprompt-only or advisory-only iterations with no materialized diff).
Iteration commits use the step binding's `Jarvis-Agent` label, a `Spec:` line
for the active subspec path (`expectedArtifactPath` when that file exists in
the worktree, otherwise the run `specPath`), and a subject from binding
metadata `title` when set, else the same creation-title fallback as terminal
completion. A throwing committer or missing agent label stops the run
`failed` with `iteration_commit_failed` (resumable) instead of persisting the
candidate terminal boundary; the loop does not advance to another iteration
— this failure now reaches a path that was previously unreachable (the guard
used to skip the call entirely) for `progress`, and is newly reachable for
every other settled result too, and resumes like any other write-loop
failure. Push and PR publication remain on terminal `complete` only, via a
separate `forceDistinctCommit` completion commit after this checkpoint.

**Controlled-loss checkpoint (abort/kill and watchdog):** an abort/kill
(`args.signal`) or watchdog (wall-segment or ceiling) race does not declare an
iteration lost the instant it wins the race against the in-flight invocation.
The main loop first waits for that raced-away invocation to quiesce — settle
or throw, once its own `AbortSignal` cancellation has actually unwound it —
and only then checkpoints. A quiesced invocation that produced a real step
result runs the same committer seam as any other settled iteration, before the
loss is declared final: on abort/kill, before `loop_finished`; on watchdog,
before the `iteration_timeout` boundary. A quiesced invocation that instead
threw (no step result to checkpoint) skips the commit and proceeds exactly as
before. This is the durability floor's boundary condition, not a broader
guarantee: it applies only once the raced-away invocation has actually
quiesced and can no longer mutate the worktree. For ordinary write-loop
iterations, waiting for that quiescence is bounded (`quiescenceTimeoutMs`,
default `DEFAULT_QUIESCENCE_TIMEOUT_MS` = 30s): an invocation that never
quiesces falls through to the un-checkpointed loss once the bound expires.
Finalization repairs are stricter, as described below. Abrupt daemon/process
death falls outside the floor entirely.

An interrupted fallback attempt — the last-started binding when the invocation
had already advanced past an earlier failed binding — checkpoints under its
own attribution: `commitSettledIteration` reads `invocation.final`, which is
whichever binding was active when quiescence happened, so the checkpoint's
`Jarvis-Agent` trailer and title/creation-title fallback name that binding, not
an earlier one that had already failed over.

A checkpoint failure during a controlled loss takes precedence over the loss
outcome that was about to be declared. On watchdog, a throwing committer
persists resumable `iteration_commit_failed` instead of `iteration_timeout`;
no boundary is committed and no publication starts, identical to a checkpoint
failure on an ordinary settled iteration. On abort/kill, the same failure
ordinarily also demotes to `iteration_commit_failed` — except when a kill was
already durably recorded (`commitGuardedKill`, checked via the current run
status) before the checkpoint ran: that killed status is authoritative and is
not overwritten. The loop instead returns its ordinary resumable abort/kill
result, appends a `run_execution_failed` log event naming the checkpoint error
for resume diagnostics, and starts no boundary or publication — resume still
retries the write path since the attempt was never marked complete.

Ready-gate and surviving-mutation repair iterations use a terminal-settlement
join instead. Before `completed`, `failed`, or `killed` becomes durable, the
repair controller is aborted and Jarvis joins both the agent process and its
invocation promise. The row remains `in-progress` while that happens. A repair
that ignores cancellation therefore keeps the row nonterminal after
`quiescenceTimeoutMs` or any other bounded wait; settlement waits until the
process and invocation promise actually finish. `blocked` and `interrupted`
are outside this finalization-repair rule.

Every settled main-loop iteration appends a distinct `iteration_commit` log
event (`v2/src/persistence/log-stream.ts`), separate from the SQLite-only
`boundary_committed` event that follows it — one is a git commit, the other a
state-store boundary, and they must stay distinguishable. The event carries
`commitSha` when this iteration produced a new commit, or `skipReason` (`no_git`
| `no_file_changes`) when it did not. The discriminator: capture
`headBefore = git rev-parse HEAD` before invoking the committer, then classify
its result as `no_git` (no `.git`), `no_file_changes` (committer returned no
sha, or returned `headBefore` unchanged — a reused HEAD, not a fresh commit),
or a fresh `commitSha` otherwise. A no-change iteration that follows a
committing iteration reports `no_file_changes`, never the prior iteration's
stale sha.

Git-backed plan/intent workflow steps commit their staging-artifact changes
(e.g. `.jarvis-intent-stage/`) in-flight the same as any other step; the
landing step's own subsequent commit still removes those artifacts from the
final tree, same as today's terminal-commit behavior.

The implement step's pre-shrink commit (workflow-runner.ts) anchors its
shrink/publication reset at the true pre-implement HEAD, not at whatever this
step's own progress iterations already committed: the worktree is materialized
first, then `headBefore` is sampled unconditionally before the step's write
loop starts, and publication resets `--mixed` to that value directly — not to
`<createdCommitSha>^`, which would land one iteration commit short of
pre-implement HEAD once a clean tree at implement completion makes the
pre-shrink committer call reuse HEAD instead of creating fresh.

**Push+PR phase:** (when commit succeeds, or resume finds an already-committed
HEAD) starts at upstream detection: a branch without upstream tracking uses
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
push/PR operations are disabled, this phase is skipped. 

PR evidence is confirmed after both the found and created path: `gh pr view <branch>` 
queries for the open PR on the branch and validates that its number, URL, and base ref 
match the requested base; only the confirmed number and URL are recorded as PR evidence. 
Missing evidence (no open PR found, or PR base mismatch) fails the publication operation 
as a permanent `pr` publication failure with one confirmation attempt (no transient retry).

**Publication evidence gate:** After all publication operations (push, PR, body refresh) succeed,
a final gate checks that evidence of publication exists: if a `pushSha` is recorded but no
`prNumber` exists, the run records `completion_commit_failed` (retryable) and skips ready 
finalization. This ensures a reported completion always implies confirmed PR evidence, preventing
silent publication gaps where code is pushed but no PR was created or found.

Every publication subprocess is awaited inside its retry boundary. A failed push or PR operation retains its
operation, message, exit code, and labelled stdout/stderr tails in durable publication evidence.
Publication failure marks the owning completion (including hidden shrink) row `failed`; workflow entry status
rolls up from that row. `completed` requires confirmed PR evidence, a green ready gate, passing diff-derived mutation verification (no uncovered changed guards), and passing runtime smoke verification (changed runnable entrypoint discovered and executed cleanly, or no runnable entrypoint found).

**PR body refresh:** after the draft PR is ensured, the publisher rewrites its
body: regenerated `Spec: <specPath>` header, an optional caller-supplied summary
block (pre-rendered markdown; omitted when absent or blank), preserved content
between plain `<!-- jarvis:narrative:start -->` / `<!-- jarvis:narrative:end -->`
markers when present, and an attribution footer from `Jarvis-Agent` trailer(s) on
commits in
`baseRef..HEAD` whose first body line begins with `Spec:`. Qualifying commits
include each per-iteration WIP commit plus the terminal completion commit when
both land on the branch. Footer
shape: one bullet per qualifying commit (`- <shortSha> <subject> — <label>`,
labels joined per commit; `unknown` when no trailer; excluded from summary),
blank line, then `Written by <labels> through Jarvis.` with first-seen dedup.
The summary sits after the `Spec:` line and before narrative markers or the footer
separator; it is rebuilt on every refresh (not read from the existing body).
Absent or blank summary ⇒ header, then narrative or footer only. Direct write
and daemon completion paths use the same plan/implement template when their
step is plan or implement.
Intent runs (`completionStep.intentOutput` set) re-derive a summary at every
publish from the landed durable dir: the workflow creation title when it is not
the generic `jarvis: complete run` fallback, then one `- <file>.md` bullet per
owned intent file (invocation ownership when recorded, else every `.md` in the
durable dir). Empty landed-file list ⇒ subject line only; generic fallback title
⇒ bullets only. Review-last intent workflows land before this derivation; both
intent branches use the same publish-site logic.
Plan and implement runs re-derive a deterministic v1-shaped template at every
publish attempt from linked subspec titles plus each first prose line, commits
from `baseRef..HEAD` (oldest first), and `baseRef...HEAD` numstat. The rendered
order is `## Subspecs`, `## Commits`, optional `## Risk cues`, then `## Change
summary`; why lines truncate at 80 characters, areas are capped at two path
segments and ordered by changed lines, and binary numstat counts as a file with
zero lines. The template follows `Spec:` and precedes preserved narrative
markers and the attribution footer. Intent keeps its landed-file summary.
Empty inputs render `(no content)` for plan/implement. Retries re-read all
inputs, so changed linked subspecs, commits, or stats are reflected.
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
worktree, (2) diff-derived mutation verification, (3) runtime smoke verification, then (4) `gh pr ready <branch>`. The default gate command is `bun run
ready`; any non-zero exit is a gate failure (missing and red gate scripts are
not distinguished), reported as `ready gate failed (exit N): <output>`. The thrown gate error
also carries the `bun run ready` command, exit code, and combined stdout+stderr output as fields. The
gate runs the `full` tier (format, lint, typecheck, tests) unconditionally,
overriding any `JARVIS_READY_TIER` in the parent environment. The test step is scoped from the run's base ref:
a diff of `<baseRef>...HEAD` (three-dot, merge-base relative) including untracked files is classified via the shared classifier; the resolved
scope is passed as `JARVIS_READY_TEST_SCOPE` (e.g., `test:v2 test:integration:v2` or `full`). When the diff fails
(unresolvable base), the scope falls back to `full`, and finalization proceeds rather than erroring.
The gate runs unbounded. On green, mutation verification inspects changes against the base ref for
uncovered guards and throws `SurvivingMutationError` with mutation text and source-file location if
any guard is unreachable from changed test code. Verification is bounded (25 inspected mutations,
5-minute wall clock); hitting a bound ends it as a pass whose `candidateCount` reflects only the
candidates actually inspected. Runtime smoke verification discovers the changed
runnable entrypoint from the production diff, executes it under a wall-clock bound to observe wiring,
and throws `RuntimeSmokeFailedError` with the executed command and failed observation if the entrypoint
execution fails; if no changed runnable entrypoint is found, verification passes with recorded inspection.
On green, the awaited flip calls `gh pr ready <branch>`
through the same bounded transient-retry
seam as publication (3 total attempts, flat 1000 ms backoff). Before the
transient classifier, the flip treats exit-0 (including empty output), and any
thrown `gh` error whose combined stdout+stderr contains (case-insensitive)
`already ready` or `not a draft`, as success without retry. Any other thrown
error is handed to the transient classifier unchanged. Gate, mutation, smoke, or flip failure
(except the success-guarded flip cases) leaves the PR draft, demotes the durable
run to `failed` on gate or mutation failure (or keeps it `completed` on smoke or flip failure), and returns
retryable `ready_gate_failed` with `readyGateError`, retryable `surviving_mutation_failed` with `survivingMutation` and source details,
non-resumable `runtime_smoke_failed` with `runtimeSmokeCommand` and `runtimeSmokeObservation`, or non-resumable `ready_flip_failed`
with `readyFlipError`, distinct from publication's `completion_commit_failed` (retryable via `resume`).
Resume of a gate, mutation, or publication failure retries publication first (idempotent), then re-runs the gate,
mutation, smoke, and flip; smoke and flip failures reject resume as terminal runs. On flip failure, when the
publication returned a PR number, the result includes `readyFlipPrNumber` to
identify the PR for manual fixing; omitted when publication returned no PR.
Gate, mutation, smoke, and `gh` are injectable seams so tests require no live
verification or GitHub credentials.

Publication failures (commit, push, PR, or body refresh) leave the durable run `completed`, expose
retryable `completion_commit_failed`, and return exit `1`; `jarvis run resume <run-id>`
may retry without creating a duplicate commit or PR. Non-fast-forward push rejection
is permanent (no retry). Transient network failures (push, PR lookup, PR creation, body refresh) retry
to 3 total attempts with flat 1000 ms backoff between re-attempts and emit
`<op>: <message>; exit=<code>; stdout: <tail>; stderr: <tail>; retrying (attempt <n>/3)` to stderr. Publication failures are normalized once with the operation, message, exit code, and independently labelled bounded output tails. Only positively identified transport failures retry (three total attempts, flat 1000 ms); auth, permission, not-found, invalid-input, rate-limit, unknown, and non-fast-forward failures make one attempt. Exhausted transient failures rethrow the original error. Subprocess, backoff
delay, retry-notice, and `gh`-readiness are each independently injectable async seams, so
publication tests exercise retries and failures without live git/`gh` calls or wall-clock
delay; every retry attempt is awaited. Missing binding attribution fails before git mutation. This boundary operates
directly in the existing external worktree and does not create locks.

Workflows suppress per-step commits and publish once after every step and hidden shrink
completes, attributed to the final contributor. The publication and finalization
boundaries match standalone runs: commit once, then push+PR and body refresh once,
then ready gate and draft→ready flip once.

Publication terminal results and their `loop_finished` row retain the normalized failure detail. The ready gate remains outside this policy; `ReadyGateError` enters repair, while `already ready` and `not a draft` satisfy the ready flip before classification.

Terminal ready-gate attribution uses the marker-prefixed failing-file records and ready-step completion boundaries documented in [`test-writing.md`](./test-writing.md). Classification is conservative: only the final failed ready step's final test attempt supplies attributable paths. Missing, malformed, stale-retry, later-non-test, partial, or mixed attribution stays `ready_gate_failed`. Each attributed path must be a nonempty normalized repo-relative path; absolute, escaping, malformed, or normalization-colliding records fail closed. The allowed set is the normalized union of the spec-tree files and all base-to-HEAD diff paths (including rename/copy/delete sides) plus untracked files, derived with NUL-safe git parsing; any unresolved diff, inventory, normalization, or spec-tree input also fails closed. When every validated failing path lies outside that set, the failure is a path-ownership heuristic only — `ready_gate_out_of_scope` with the normalized outside paths — not proof the run did or did not cause the red. Deadline-killed gates, successful gates, and `requiredIntegrationScope` failures are never eligible because they lack equally complete terminal file attribution.

The captured snapshot is the retry identity: later operator edits are excluded.
On continuation (`jarvis run resume`, daemon recovery, queue promotion), execution
re-resolves agent/model bindings from the current machine profile while snapshot
fields such as `stepRules`, `expectedArtifactPath`, and outer-loop `agents` stay
snapshot-backed; on-disk `agentModelConfig` in the snapshot may lag until updated.
Clean-slate workflow re-dispatch after `--reset-despite-dirty` uses the same fresh
admission binding path as a new write step.

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
durable branch pointer before running. For linked-index implement, the runner's
first routing read happens before that materialization; the write loop creates
the worktree on its first `executeWrite` call.

When completion publication's ready gate fails with a `ReadyGateError`, the write loop runs project autofix once per repair entry — after the repair fence allowset is frozen and before the first repair agent — using the registered project's `fixCommand` when set, else built-in `bun run fix` (same skip-when-absent package-manager script semantics as v1 `runReadyAndCommit`). Autofix validates staged candidates through the frozen allowset, commits in-scope changes with the retained completion subject, `Jarvis-Agent:` trailer, and `Jarvis-Ready-Gate: autofix`, then republishes and re-gates without emitting `ready_gate_repair` or consuming repair iterations or the iteration budget. A non-zero or timed-out fix command fails closed as retryable `completion_commit_failed` without entering agent repair; a still-red gate after successful autofix falls through to bounded agent repair with the full `MAX_READY_GATE_REPAIRS` budget. The repair loop then invokes the agent with the gate command, exit code, and the last 16 KiB of gate output, commits and republishes after each repair, for at most three repair attempts. Repair iterations consume the normal iteration budget; a blocked repair, exhausted budget, or still-red gate returns retryable `ready_gate_failed`. When the repair cap is exhausted by non-timeout red gates, the terminal `loop_finished` row records `readyGateOrigin: repair_budget_exhausted` and `readyGateRepairCount: 3`, persists a retained finalization checkpoint (completion attribution plus draft-PR evidence), and demotes the durable row to `failed` while staying resumable. `jarvis run resume` on that lineage replays only the finalization tail — operator commit (when needed), ready gate, mutation verification, runtime smoke, and draft→ready flip — without write-agent re-entry; a green gate completes the same row, while a red gate returns it to `failed` / `ready_gate_failed` / resumable for another gate-only resume. Flip failures return `ready_flip_failed` and do not trigger repair.

Before the first ready-gate repair invocation, Jarvis derives and freezes an allowset from the committed `<baseRef>...HEAD` diff plus the resolved spec scope (a directory spec scope, or the parent of an `index.md`, allows descendants; a standalone spec file allows only itself). The frozen allowset is persisted on the durable run row with `outcomeKind: frozen` before autofix or the repair agent runs; a rejected out-of-scope path upgrades provenance to `outcomeKind: completion_commit_failed` with the normalized offending path. After each autofix or repair iteration, and before its completion commit or republish, the harness enumerates the exact candidate paths that repair completion staging would include — additions, deletions, type changes, tracked ignored changes, submodules, and both rename sides, read with NUL-delimited git output and normalized to repository-relative paths without lossy decoding or repository escape. Candidates are byte-sorted by normalized path; the first path whose basename matches `.jarvis-*` fails the repair as retryable `completion_commit_failed` naming that path with deterministic escaped rendering. The first path outside the frozen allowset fails the repair as retryable `completion_commit_failed` naming that path with deterministic escaped rendering (`Ready-gate repair stages path outside run diff and spec tree:`). On markdown-only workflows — intent split (`intent.prompt.split`) and plan draft (`plan.prompt.draft`) classified from the originating write-step `promptId`, not the repair iteration's `write.ready-repair` id — Jarvis also freezes markdown output roots at first repair freeze (`ready-intents/` plus `.jarvis-intent-stage/` for intent; landed `durablePath` plus `.jarvis-plan-stage/` for plan, taken from the landing/repair-input contract at freeze time and persisted alongside the allowset with `markdownOnly: true`). Failure to derive or persist non-empty markdown output roots at that freeze fails the repair boundary as retryable `completion_commit_failed` (`Ready-gate repair fence could not reconstruct persisted markdown workflow output roots:`) instead of disabling the markdown layer for the rest of the loop. After the run-diff allowset check, every staged repair path must also be a `.md` file under one of those frozen roots; the first byte-sorted offender outside that layer fails as retryable `completion_commit_failed` with `Ready-gate repair stages path outside markdown workflow output roots:` and deterministic escaped rendering — separate from the run-diff fence wording. When `scripts/test-slice.ts` is among the candidates, the harness compares the set of string literals in the `LOAD_SENSITIVE_FILES` array binding at committed `HEAD` (membership already on the branch before repair edits, including legitimate implement-time growth since `<baseRef>`) against the staged worktree copy (reorder and comment-only churn that leaves membership unchanged pass; only additions fail; removals are permitted) and rejects a strict superset as retryable `completion_commit_failed` naming the first added entry. Completed-run retry and `jarvis run resume` reconstruct and reuse the persisted allowset and markdown output roots — they do not derive a new allowset or markdown roots from the dirty worktree — and enforce the fence before generic completion can stage or publish recovery changes when provenance is present (`frozen` or `completion_commit_failed`). A null ready-gate repair fence column means ready-gate repair never ran, so those recovery paths proceed without fence enforcement. An unparseable fence column fails closed as `completion_commit_failed`. On markdown-only runs with active repair-fence provenance (`markdownOnly: true`), missing, empty, or unparseable `markdownOutputRoots` also fail closed as `completion_commit_failed` — recovery does not re-derive roots from the dirty worktree and does not skip the markdown layer. Review-mutation recovery (`resumeReviewMutationFinalization`) is a separate production route: it resolves the completed write sibling, loads that row's persisted fence provenance (allowset, `markdownOnly`, and markdown output roots), and enforces the same layered checks before its commit, mutation-repair recommit, or publication tail — a rejected out-of-scope or non-markdown path stays dirty and settles retryable `completion_commit_failed` rather than being swept into a later recovery commit or publish. Primary completion, mutation repair, and the bounded repair loop itself are outside this fence; in-scope repairs that stage only allowed paths keep the existing repair behavior.
Resumed publication retry and surviving-mutation repair keep the durable row `in-progress`
during repair. Every covered completion, failure, or kill first cancels and fully joins
the repair; only then may its existing terminal status and resumability become visible.
Finalization-repair invocations pass `joinProcessOnIdleStall` so idle-output expiry
waits for the child process to close before settling `stall`; ordinary write and review
invocations keep the fast idle stall without that join.

The write prompt injects the v2 restraint principles (`write.principles`) at
every iteration; see [`coding-standards.md`](./coding-standards.md) for the
canonical principle text and rationale.

## Terminal token

Write-step prompts carry `stepRules` from `DEFAULT_WRITE_STEP_RULES`: the
agent's final response line must be exactly one of `done`, `no-work`, `blocked`,
or `progress`, with nothing after it. `done` and `no-work` end the step; use
`progress` when work remains and the agent is not stuck; use `blocked` when
stuck and record the blocker where the mode's rules require (mode-neutral — no
spec path in the shared text). Patch mode binds appending `## Blocker` to
`blocked` in `prompts/patch/rules.md` §Stop. Plan-draft and intent-split
builders append the same text under `## Step completion` (see
[`prompts.md`](./prompts.md)); `write.execute`, `patch.prompt.body`, and
`patch.prompt.shrink` interpolate it via `<STEP_RULES>` as the final block.

## Write-step prompt placeholders

Default write steps (`executeDefaultWrite`) resolve placeholders from the
registry's declared requirements for the step's `promptId`, then overlay
caller-supplied `promptPlaceholders` (caller values win). Unresolved required
names fail the step as `model_config` before any binding runs.

| Placeholder | Source |
| --- | --- |
| `SPEC_PATH` | Worktree-resolved `specPath` |
| `STEP_RULES` | Step `stepRules` (`patch.prompt.body`, `patch.prompt.shrink`, `write.execute`) |
| `PRINCIPLES` | `write.principles` registry body |
| `REPO_GUIDANCE` | `AGENTS.md` and `CLAUDE.md` at the worktree root (same as v1 `readRepoGuidance`) |
| `ACTIVE_SUBSPEC_PATH` | Worktree-resolved `expectedArtifactPath`, with trailing newline when non-empty |
| `ACTIVE_SUBSPEC_BODY` | File contents at `expectedArtifactPath` (empty when missing) |
| `PATCH_RULES` | `patch.rules` registry body |
| `SIBLINGS_BLOCK`, `TIMEOUT_CHECKPOINT_CONTEXT` | Empty string (no v2 consumer yet) |

Git-derived shrink placeholders (`ALLOWLIST`, `BRANCH_DIFF`, `RUN_SCOPED_DIFF`,
`SPEC_TREE`) and plan-draft placeholders are supplied by the caller —
`workflow-runner.ts` for shrink, `buildPlanDraftPrompt` for plan draft.

The step runner's parser is more lenient than the prompt — see
[`shared-step-runner.md`](./shared-step-runner.md): exact match, then last
bare-token line, then last token word anywhere in stdout. When no token word
appears at all (including an empty response), the runner fires one token-only
re-prompt (`write.token-reprompt`) asking for exactly one of the four tokens
before giving up; the write loop appends a `token_reprompt` run-log event
(attempt id + the first, token-less response text, truncated to
`INVALID_TOKEN_LOG_MAX_CHARS`) whenever this fires, visible via `jarvis2 tui`
log-follow. The re-prompt reply is accepted only as an exact token — a
hedging reply that merely names the tokens in prose is a second miss. A
second miss with unsatisfied contracts records `invalid_token`, with the
*first* response's text as `tokenText`, and the existing `invalid_token_detail`
event follows the `token_reprompt` event in the log. A second miss whose
contracts all pass records `complete` (token `done`) and the write loop
commits and publishes as for a token-emitting completion. A re-prompted
`done`/`no-work` runs contract checks exactly as a first-response token would.
When a `blocked` token misses the blocker-text contract after one
`blocker_reprompt`, the write loop appends `missing_blocker_detail` (attempt id +
the re-prompt response text, truncated to `INVALID_TOKEN_LOG_MAX_CHARS`) after
`blocker_reprompt` — same truncation and ellipsis as `token_reprompt` /
`invalid_token_detail`. Every write-loop `contract_miss` boundary appends
`contract_miss_detail` (attempt id, `failedContractId`, optional
`failureReason` when the settled contract carried a dynamic reason, and the
final agent response body used for contract evaluation at that boundary,
truncated to `INVALID_TOKEN_LOG_MAX_CHARS`) after `boundary_committed`.
Plan-draft shape `contract_miss` from the normalizer carries the deterministic
rejection message in `failureReason`, `contract_miss_detail.failureReason`, and
the harness-appended `## Blocker` on staged `join(expectedArtifactPath,
"intent.md")`; bare missing-tree failures still settle `plan.draft.shape`.
`contract_miss_detail.responseText` remains agent stdout, not the normalizer text.
`jarvis run list` and `jarvis run wait` project the chronologically last
`contract_miss_detail.failureReason` onto `error.contractMissDetail` for
`contract_miss` rows when the log tail is readable; see
[`daemon-host.md` § Operator error](./daemon-host.md#operator-error-on-list-and-wait).

## Coverage advisory

Implement write completion may issue one uncovered-changed-line advisory re-prompt before
the terminal boundary. The advisory is **deliver-only**: it observes code coverage on
changed lines, reports uncovered sites to the agent for awareness, does not change
the completion outcome, and does not increment `iterationsConsumed`.

**Ordering and scope:**

The coverage advisory runs only when an implement write (`promptId: "patch.prompt.body"`)
completes with `kind: "complete"`. After the step result is ready but before the
completion boundary is committed, the write loop invokes `reportUncoveredChangedLines`
against the worktree base. If uncovered sites are found, the loop runs the coverage
advisory re-prompt (using the registered `write.coverage-advisory` artifact) through
the same bindings, logs the response, then commits the terminal boundary. All store
writes from the advisory (including invocation telemetry) occur before the attempt's
terminal `boundary_committed` log event.

**Fail-soft and skip conditions:**

When no uncovered sites are found, the advisory is skipped entirely. Coverage collection,
LCOV parsing, and advisory re-prompt invocation errors are fail-soft: errors do not
fail the run or stop the write loop. The advisory response is logged but not parsed
or acted upon — it is advisory feedback only, not contractual output.

The terminal `runStatus` and `outcomeKind` remain whatever `complete` already committed,
and no store writes occur after the step settles.

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
blocker detection failures and shape failures. When normalization rejects a
staged tree (for example a multi-surface acceptance bullet or a broken index
link), the normalizer message propagates through `failureReason`,
`contract_miss_detail.failureReason`, and the harness-appended `## Blocker` on
staged `intent.md`; `contract_miss_detail.responseText` stays agent stdout.

## Intent split landing contracts

`intent.prompt.split` write loops validate staged ready-intent shape before
accepting `done`, using the same `validateIntentStage` pipeline as deferred
landing (prefix normalize → content repair → filename validation → content
validation), the same rogue-path source (`findIntentLandingRoguePaths` over
`listWorktreeChangedPaths`) as `landIntentWorkflowOutput`, and the same
`.jarvis-intent-stage/` modified-path subset for shape validation.

Violation taxonomy:

- `NN-` ordering prefix, `name:`/slug alignment, H1 repair, and other harness
  silent content repairs — applied inside `validateIntentStage` without a
  `write.landing-contract-reprompt` iteration.
- Agent-fixable shape the harness does not repair (prerequisites prose, missing
  `## Prerequisites`, one-bullet-per-line prerequisites, etc.) — one write-loop
  iteration reprompt via `write.landing-contract-reprompt` carrying the validation
  message and offending staged file; consumes `maxIterations` across separate loop
  iterations. Valid sibling staged files are preserved across reprompt iterations.
- Non-repromptable (rogue path, duplicate/collision after normalize, I/O) —
  immediate terminal write-loop `landing_failed` without spending reprompt budget.
- Empty `.jarvis-intent-stage/` when the agent emits `done` — `artifact.exists`
  `contract_miss` on the write step, not the landing gate above.

After the reprompt budget is spent with the violation unfixed, the write loop
settles `landing_failed` with `.jarvis-intent-stage/` bytes intact,
`resumable: true`, and operator `nextAction: "resume"`. Resume and in-loop
reprompt iterations preserve populated stage bytes (no stage wipe). A paused run
after a repromptable miss restores violation/offending-file context from the
last `landing_contract_reprompt` log event. Workflow-tail `landing_failed` for
non-repromptable faults during deferred landing is unchanged.

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
critic and actuator prompts are rendered at dispatch from the registered layered
artifacts. They carry the stage-boundary contract inline, include the current
filename-ordered staged Markdown and spec guidance, and pass the unchanged verdict
byte-for-byte via a delimited data zone — enabling the enforcement mechanisms in
this section.

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
After the final cycle, plan landing publishes that exact file at the durable spec
root, including zero-byte no-findings verdicts; landing retries reuse the review
checkpoint, while a fresh dispatch runs review again.

**Role boundary:** the critic is advisory-only. After each critic invocation the
executor snapshots the worktree and fails the cycle when any filesystem change
occurred; unauthorized edits are restored before the actuator runs. The actuator
is the sole mutator of the spec tree. Actuator prompts carry the unchanged verdict
plus the same materialized draft context as the critic.

Workflow dispatch for the `plan-reviewed-light` preset supplies the plan review profile on the
loaded review step; see [`workflow-runner.md`](./workflow-runner.md#review-dispatch).

## Runtime smoke verifier

The runtime smoke verifier proves a run's changed production behavior is wired
into its runnable surface by deriving a runnable entrypoint from the run-base
production diff, executing that real entrypoint bounded and non-destructively,
and observing its runtime behavior.

**Runnable-surface discovery:** The verifier inspects the `<runBase>...HEAD`
production diff to identify changed production files and selects a runnable
surface that imports the changed module. It follows relative static imports from
`v2/src/daemon-entrypoint.ts` and `v2/src/cli.ts`; directory placement alone
does not establish ownership. A direct change to either surface selects that
surface.
Non-production files (test files, spec, docs) are excluded from discovery.
When multiple changed files exist, the first discovered runnable surface is selected.
Changed paths come only from the run-base production diff; import ownership is
read from the checked-out source tree.

**Observation and execution:** The verifier executes the discovered entrypoint
with its bounded safe probe and observes its success or failure. The CLI runs
`bun run v2/src/cli.ts help`. The daemon executes a full lifecycle handshake
against an isolated daemon: `bun run v2/src/cli.ts daemon start`, then
`bun run v2/src/cli.ts daemon status` to verify running state, then
`bun run v2/src/cli.ts daemon stop` to clean up. The lifecycle verifies that
CLI and daemon code are compatible and the IPC contract works end-to-end.
Execution is bounded by a shared wall-clock timeout (default 10 seconds).
The verifier returns failure when any step fails, times out, or status does not
report running state.

**Bound and non-destructiveness:** Smoke execution is bounded by a shared
wall-clock limit (10000 milliseconds) across all handshake steps and ends the
smoke as a failure when exceeded. The daemon lifecycle handshake uses an
isolated temporary directory (not the operator's `~/.jarvis`) and reaps all
spawned processes and local IPC artifacts on all outcome paths (success, failure,
timeout). The CLI help probe and daemon lifecycle both test valid invocations
without modifying operator state or contacting the operator's daemon.

**Results:** The verifier returns one of three structured results:

1. **`observed-clean`** (pass): The discovered entrypoint executed successfully
   within the wall-clock bound, proving the changed behavior is wired and
   reachable at runtime.

2. **`not-runnable`** (pass): No runnable surface was discovered. The
   result records the inspected changed paths and the discovery reason
   (e.g., "no production files changed" or "no changed runnable entrypoint found").
   This is a pass, not a failure: unchanged runnables do not require smoke testing.

3. **`smoke-failure`** (failure): The discovered entrypoint execution failed or
   timed out. The result names the executed command
   and the failed observation (stderr output, timeout message, or thrown error).

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
| `jarvis daemon stop [--force]` | `stopped`, or blocker IDs on stderr | `0`, or `1` when guarded |
| `jarvis daemon status` | `running loaded=<revision> current=<revision>`, `stale loaded=<revision> current=<revision>`, or `stopped` | `0` when running, `1` when stale or stopped |
| `jarvis daemon log` | Retained bytes of the daemon process log (`~/.jarvis/daemon.log`) on stdout | `0` on success, `1` with `daemon process log not found: <path>` on stderr when absent, `1` on read failure |
| `jarvis daemon log --follow` | Replay then follow appends on stdout | `130` on SIGINT; `1` on read/watch/reopen failure or when the file is removed while following (missing path on stderr) |

`jarvis daemon stop` refuses when durable non-terminal runs exist and reports
their IDs on stderr; it does not print `stopped`. Add `--force` to bypass that
guard and use the existing shutdown path. See the lifecycle contract in
[`daemon-host.md`](./daemon-host.md#stopdaemonsocketpath-options).

`jarvis daemon status` probes the PID file and socket for lifecycle state and
compares the daemon's boot-time executable-tree digest with the invoking CLI's
current digest (`v2/src/**`, `shared/**`, and repo manifests). `loaded` and
`current` in the output are Git HEAD values for display; they may differ after a
docs-only merge while the daemon remains running.
Output format:
- `running loaded=<revision> current=<revision>` (exit 0): daemon is alive and executable digests match
- `stale loaded=<revision> current=<revision>` (exit 1): daemon is alive but executable digests differ (executable code changed since daemon boot)
- `stopped` (exit 1): daemon process dead or socket unreachable

The daemon captures its startup Git HEAD and executable digest once at boot.
Exit `0` means running; `1` means stale or stopped. PID file absence or parse
failure returns `stopped` without further checks. Note: this is distinct from
the daemon IPC `status` RPC response, which work-dispatch guards and `jarvis tui`
use after `health` to prove the channel is live. See [TUI CLI](#tui-cli).

`jarvis daemon log` reads the process log directly off disk — no PID, socket, or
IPC-status check, so it works regardless of whether the daemon is running. It is
distinct from `jarvis run log <run-id>` and `jarvis tui log <run-id>`, which read
structured per-run records over IPC (see [Run control CLI](#run-control-cli) and
[TUI CLI](#tui-cli)). Only the bare and `--follow` forms are accepted; any other
flags, args, or ordering print `usage: jarvis daemon log [--follow]` and exit `1`.
See [`daemon-host.md`](./daemon-host.md#jarvis-daemon-log---follow) for the
replay/follow contract (lossless handoff, truncation/replacement resume,
removal/failure reporting).

## TUI CLI

Socket default: `~/.jarvis/daemon.sock` (same as daemon lifecycle commands).

Flow: discover live daemon sockets → connect to each → IPC `health` → IPC `status` → aggregate daemon `list` results → interactive run monitor. `jarvis tui` does not call `executeWriteLoop` locally and does not send `start` or log-stream frames.

Per-tick rediscovery: Every refresh tick (second), the monitor rediscovers live daemon sockets, connects to newly discovered daemons, and closes connections to daemons that are no longer live. Newly discovered sockets contribute their runs on the next refresh with no operator action. When a daemon exits, its connection is closed, its exclusive runs are removed from the view, and the monitor continues rendering remaining daemons. Superseded (old digest) and superseding (new digest) daemons are visible together while both remain live. If the selected run's daemon is closed, selection clears automatically. Rediscovery failure leaves the current connection set intact for that tick, ensuring transient discovery errors do not degrade the view. Steering commands target the daemon currently owning the selected run, dynamically updating as daemons are discovered or exit.

The monitor aggregates every live daemon's run list into one view: each run ID appears once (deduped), the daemon reporting the run `isLive` is the owner and receives all steering commands (`pause`, `resume`, `kill`). Non-invoking connections that fail to `list` are skipped without aborting the monitor. The invoking-socket connection is evicted (closed and removed) when its `list()` call fails, allowing a fresh connection to be established on the next tick (useful when the daemon has been replaced on the same socket path). When discovery returns no sockets, the monitor connects only to the invoking digest's socket and behaves as before.

`jarvis run list` queries every live keyed daemon under `JARVIS_HOME` and merges their run lists by run ID, preferring rows marked `isLive` by the owning daemon. `jarvis run log` and `jarvis run wait` resolve the run's owning daemon the same way before opening the log stream or issuing `wait`.

`jarvis run wait` renders a timed-out loop as `loopOutcomeKind:
"iteration_timeout"` with failed run status; it is not rendered as
`run_execution_failed`.

| Command | Output | Exit |
| --- | --- | --- |
| `jarvis tui` | Interactive ink run monitor; entry-time guard/RPC failure: ink `<code>: <message>`; connect-time unavailable: message naming `~/.jarvis/daemon.sock` and `jarvis daemon start` | `0` operator quit; `1` connect-time unavailable or entry-time guard/RPC failure before the monitor opens |
| `jarvis tui log <run-id>` | Interactive ink structured log follow over IPC tail; one line per record with `seq`, `kind`, and present per-kind fields (`attemptId`; `attemptId`/`outcomeKind`/`runStatus`; `loopOutcomeKind`/`iterationsConsumed`/`resumable`; kind only for `run_execution_failed`); connect-time unavailable: message naming `~/.jarvis/daemon.sock` and `jarvis daemon start`; mid-stream transport loss: automatic resume from last appended record sequence (no duplicate, no operator action); exhausted retries: ink `tail_resume_exhausted: <message>` | `0` operator quit or benign stream end; `1` connect-time unavailable or exhausted retry attempts; operator quit during retry wait exits `0` |

On entry with a non-empty aggregated daemon `list`, the monitor selects the first row
(daemon order is newest-first), issues daemon `wait` for that `runId`, and shows
one row per run with `runId`, `project`, `branch`, `status`, and liveness
(`live` / `not-live`, matching `jarvis run list`). List-row `status` is the
poll-time value from `list` only.

On entry with an empty aggregated daemon `list`, the monitor shows an explicit empty state,
keeps no selection, and sends no `wait`.

The run list refreshes every second from aggregated daemon `list`, preserving selection by
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
a fresh `wait` for the newly selected run (on the owning daemon), and ignore any late reply from the
abandoned request.

Production ink selects the first selectable row on entry. Down/`j` and Up move
selection through the rendered non-queued rows, clamping at either end. These
bindings route through the same selection path as the injectable view-host seam.

When the selected row includes workflow metadata, the monitor renders per-step
status from `list` only; single-step rows keep the prior layout. The outcome
panel still comes from `wait`.

The monitor exposes injectable `pauseSelected`, `resumeSelected`, and
`killSelected`. Each maps 1:1 to the owning daemon's
`pause`, `resume`, and `kill` on the selected `runId`; no selection → no-op with
inline `no run selected`. No client pre-gate on liveness or terminal rows—daemon
and transport failures surface inline as `<code>: <message>` or
`daemon_error: <message>`; mid-session errors keep the monitor open. Steering
feedback replaces on the next action and clears on selection change;
`waitState` errors are unchanged. Successful `resume` re-issues `wait` and
abandons any prior ready snapshot; other successful actions keep the existing
refresh/`wait` loop. Success-feedback layout is deferred.

Operator quit on the run monitor (`jarvis tui`) is `q` or Ctrl-C. Quit closes all
connected daemon RPC clients and exits `0`.

`jarvis tui log <run-id>` discovers live daemon sockets and resolves the run's
owning daemon across all live instances (preferring daemons where `isLive` is true),
then opens an IPC tail stream on the owner's socket, replays persisted records,
follows live appends, and stays open after replay until operator quit or benign
server `stream-end`. It does not invoke run-control RPCs or the connect-scaffold
`health`/`status` path. Operator quit is `q` or Ctrl-C; quit closes the tail stream
client (sends `stream-end`) and exits `0`. When the run ID is absent on every live
daemon, the command tails on the invoking socket (same behavior as the single-socket path).

On mid-stream IPC transport loss (daemon restart, network error), the tail automatically
reconnects to the live owner socket and resumes from the last appended record sequence
(`afterSeq` cursor), avoiding duplicate output. Reconnection attempts are bounded (default:
5 attempts, exponential backoff from 100 ms to 2 s). If all retries are exhausted, the
session shows `tail_resume_exhausted` feedback and exits `1`. Operator quit during a retry
wait exits `0` without feedback (no operator action is incomplete due to transport loss—
the quit is clean termination of a transient recovery state).

When the daemon is not reachable, start it with [`jarvis daemon start`](#daemon-cli)
before retrying `jarvis tui` or `jarvis tui log <run-id>`.

## Run control CLI

| Command | Input mapping | Output | Exit |
| --- | --- | --- | --- |
| `jarvis run start ...` | Same required flags as `jarvis write`; `--project-root`, `--project`, `--branch`, `--base`, `--spec`, `--artifact`, optional `--max-iterations`; mapped to the same `WriteLoopInput` fields and sent over IPC as one `start` request | Run ID | `0` on success |
| `jarvis run workflow <name> ...` | Selects a registered workflow builder by name (`intent`, `plan`, `implement`, and legacy aliases such as `intent-reviewed`). For `implement`, required flags are `--base` and `--spec`. Optional flags: `--branch` (defaults to parent directory basename of resolved `--spec`), `--artifact` (required for non-index specs, ignored for index specs), `--review-passes <n>` (non-negative integer; overrides the registered project's `implement.reviewPasses`, default `1`; pass `0` to skip review), `--detach` (return after admission; see [workflow launch modes](#workflow-launch-modes)). A relative `--spec` is resolved from invocation cwd before project lookup; project is resolved from the registered project containing the resolved spec path (not from invocation cwd). Spec and artifact paths passed to the workflow are worktree-relative. The `implement` builder supplies `role`/`promptId`/`agents`/`agentModelConfig` and sends one IPC `start` request carrying `{ steps }`, then blocks on an IPC `wait` request for the resulting run ID unless `--detach` is set | Attached (default): run ID line, then one minified JSON line: `{runStatus, loopOutcomeKind?, iterationsConsumed?, resumable?, error?, worktreePath?}` — only present optional fields included. Detached (`--detach`): run ID line only | Attached: `0` on success; `1` on missing/unknown name, invalid flags, spec outside registered projects, invalid `implement.reviewPasses` project config, machine-config validation failure, or daemon `wait` error — selection, parsing, project resolution, effective review-count resolution, and builder errors occur before daemon connection; otherwise see [wait exit codes](#wait-exit-codes) for the workflow run's terminal exit code. Detached: `0` when admission succeeds (`start` returns a run ID); `1` on the same pre-admission failures and on failed admission; exit `0` does not mean the workflow finished — observe completion via `jarvis run wait`, `jarvis run list`, or `jarvis tui` on the printed run ID |
| `jarvis run list` | None | One tab-separated row per run: `runId project branch status liveness reason retryable nextAction worktreePath publicationFailure prNumber prUrl` — `publicationFailure` is JSON or `-`; `prNumber` and `prUrl` are the confirmed PR evidence from publication or `-` when not available | `0` on success |
| `jarvis run list --since <duration\|timestamp>` | Optional `--since`: relative duration (`<positive-integer><d\|h\|m\|s>`, subtracted from query time) or absolute Unix ms / ISO 8601; cutoff is inclusive on `created_at`; bypasses the default fifty-terminal-run retention window. Optional `--project`, `--branch`, `--spec`, and `--status` filter durable store columns with exact case-sensitive match (`--spec` maps to `spec_path`; `--status` accepts one terminal status: `completed`, `failed`, `blocked`, `interrupted`, `killed`). Set filters compose conjunctively with each other and with `--since`. Optional `--limit <positive-integer>` on a filtered query (any set list filter field) caps matching rows; when omitted on a filtered query each daemon returns at most **200** newest matches before CLI merge (merged output can exceed **200** with multiple live daemons). Bare `--limit` without a filter: same row count and retention as plain `jarvis run list`; `limit` is passed on the RPC but does not truncate on the retention path | Same row format as `jarvis run list` | `0` on success; `1` with `invalid_since`, `invalid_limit`, `invalid_project`, `invalid_branch`, `invalid_spec`, or `invalid_status` before any `list` RPC when the corresponding flag is invalid |
| `jarvis run log <run-id>` | Run ID | One compact JSON line per persisted record; replay only, exits once the daemon closes the stream | `0` on stream end/client close |
| `jarvis run log <run-id> --follow` | Run ID | Same replay, then follows new records until the daemon closes the stream on its own once the followed run settles (or the client disconnects) | `0` on stream end/client close |

`jarvis run log` on an unknown run ID prints no output and exits `0` (pre-existing, unmasked by this
behavior — not caused by it).
| `jarvis run pause <run-id>` | Run ID | `paused <run-id>` | `0` on success |
| `jarvis run resume <run-id>` | Run ID | `resumed <run-id>` | `0` on success |
| `jarvis run kill <run-id>` | Run ID | `killed <run-id>` | `0` on success |
| `jarvis run wait <run-id>` | Run ID | One minified JSON line: `{runStatus, loopOutcomeKind?, iterationsConsumed?, resumable?, error?}` — only present optional fields included | See [wait exit codes](#wait-exit-codes) |

## Pipeline CLI

| Command | Input mapping | Output | Exit |
| --- | --- | --- | --- |
| `jarvis pipeline start <project> (--seed <path> \| --seed-text <text>) [--detach]` | Registered `<project>` name (not cwd-derived). Exactly one of `--seed` (relative file path from invocation cwd) or `--seed-text` (inline prose). Optional `--detach` (return after admission; see [pipeline launch modes](#pipeline-launch-modes)). Resolves `projects.<project>.pipeline` from machine config, loads agent model config, and runs `resolveProjectPipeline` before any daemon connection or durable admission | Attached (default): admitted pipeline ID line, then on terminal completion one minified JSON line `{kind:"terminal",state}`. Detached (`--detach`): admitted pipeline ID line only | Attached terminal: `0` on `succeeded`, `1` on other terminal states. Detached: `0` when admission succeeds; `1` on pre-admission failure or failed admission. Pre-admission failures (unregistered project, missing `pipeline` key, invalid project pipeline config, seed flag misuse, seed path errors, machine-config load errors) exit `1` with stderr detail and no pipeline ID on stdout |
| `jarvis pipeline list` | None | One minified JSON line `{pipelines:[...]}` mirroring daemon `pipeline_list`: each pipeline has `pipelineId`, `name`, derived `state`, and ordered `stages` with `stageId`, `branchKey`, `status`, and nullable `workflowInvocationId`; empty store prints `{pipelines:[]}` | `0` on success; `1` on connection or RPC failure. Issues one non-blocking `pipeline_list` RPC with no client-side polling — does not follow live transitions. End-to-end latency is bounded by the daemon snapshot contract (typically within **500ms** even when pipelines remain non-terminal; see `daemon-pipeline-observation.test.ts`), not by CLI-side waiting |
| `jarvis pipeline wait <pipeline-id>` | Pipeline ID (required, non-empty; usage error before daemon connect when missing or whitespace-only) | One minified JSON line naming the boundary: `{kind:"terminal",state}` or `{kind:"awaiting-approval",stageId,branchKey}` | `0` on `awaiting-approval` or terminal `succeeded`; `1` on other terminal states, connection/RPC failure, or operator abort (SIGINT closes IPC — stderr connection detail, no boundary JSON on stdout). Returns promptly when the pipeline is already at a boundary. `unknown_pipeline` and other daemon errors print `<code>: <message>` on stderr |
| `jarvis pipeline approve <pipeline-id> <stage-id> <branch-key>` | Pipeline ID, stage ID, and branch key (all required, non-empty after trim; usage error before daemon connect when missing, extra, or whitespace-only) | Silent on success | `0` when the daemon returns `kind: "applied"` (decision durably admitted, not pipeline finished). `1` on `kind: "refused"` (daemon `reason` verbatim on stderr), malformed result envelope (`invalid daemon response` on stderr), connection failure, or RPC error (`<code>: <message>` on stderr). Issues one `pipeline_approve` RPC with `{ pipelineId, stageId, branchKey }` |
| `jarvis pipeline reject <pipeline-id> <stage-id> <branch-key>` | Same positional rules as approve | Silent on success | Same exit semantics as approve; issues one `pipeline_reject` RPC with `{ pipelineId, stageId, branchKey }` |
| `jarvis pipeline resume <pipeline-id>` | Pipeline ID (required, non-empty after trim; usage error before daemon connect when missing, extra, or whitespace-only) | Silent on success | `0` when the daemon returns `kind: "resumed"` (pipeline admitted for detached continuation, not finished). `1` on `kind: "refused"` (daemon `reason` verbatim on stderr), malformed result envelope (`invalid daemon response` on stderr), connection failure, or RPC error (`<code>: <message>` on stderr). Issues one `pipeline_resume` RPC with `{ pipelineId }` |

**Pre-admission boundary:** project registry lookup, required `pipeline` key, agent model config load, seed resolution, and `resolveProjectPipeline` all run before `withConnectDispatch` connects or admits. Invalid configuration never creates durable pipeline rows.

`jarvis pipeline start --seed` resolves the operator-relative path from invocation `cwd`, requires a regular file under the registered `<project>` root after `realpathSync` containment (same semantics as intent `resolveSeed`), and probes read access without inlining content. Outside-root paths, symlink escapes, resolution failures, and unreadable files reject before daemon connect. Admitted `--seed` context carries `seedPath` only; `--seed-text` carries `context.seed` only.

### Pipeline launch modes

`jarvis pipeline start` admits through the same pre-admission validation whether or not the shell stays attached. **`--detach`** opts out of client-side `pipeline_wait` after admission: stdout is the admitted pipeline ID only and exit `0` means **admitted**, not pipeline finished. The default attached mode prints the same ID, then loops `pipeline_wait`: on `{ kind: "awaiting-approval", stageId, branchKey }` it re-issues `pipeline_wait` without printing boundary JSON or exiting; it exits only on `{ kind: "terminal", state }`, printing one minified terminal JSON line and an exit code keyed to `state` (`succeeded` → `0`, other terminal states → `1`). Operator abort during attached start (SIGINT closes the IPC client during `pipeline_wait`) follows the same pattern as `jarvis run wait` / workflow attach: stderr connection detail, non-zero exit, no boundary JSON on stdout. Observe a detached pipeline via `jarvis pipeline list` (point-in-time snapshot) or `jarvis pipeline wait <pipeline-id>` (block until a boundary).

**List vs wait:** `jarvis pipeline list` issues one `pipeline_list` RPC and prints the durable snapshot immediately — it does not block on live transitions or poll for completion. Stage rows include `branchKey` per durable branch row (single-default pipelines use `branchKey: "default"`). `jarvis pipeline wait <pipeline-id>` issues one blocking `pipeline_wait` per invocation and prints boundary JSON when the pipeline reaches terminal state or `awaiting-approval`. Unlike attached start, standalone wait exits `0` at an approval gate (stdout `{kind:"awaiting-approval",stageId,branchKey}`) as well as on terminal `succeeded`.

**Approve vs reject:** `jarvis pipeline approve <pipeline-id> <stage-id> <branch-key>` and `jarvis pipeline reject <pipeline-id> <stage-id> <branch-key>` admit one branch-scoped decision through `pipeline_approve` / `pipeline_reject` with `{ pipelineId, stageId, branchKey }`. Read `branchKey` from `pipeline wait` boundary JSON or `pipeline list` stage rows (`status: "awaiting"`). Exit `0` on `kind: "applied"` means the decision was durably admitted, not that the pipeline finished — pair with `pipeline wait` or `pipeline list` for progress. Refused decisions (`status_not_awaiting`, `invalid_decision`, `branch_key_required`, etc.) print the daemon `reason` verbatim on stderr and exit `1` with no success stdout. Malformed result envelopes follow the same `invalid daemon response` pattern as `pipeline wait` / `pipeline list`.

**Resume vs run resume:** `jarvis pipeline resume <pipeline-id>` re-enters a failed or `awaiting-approval` pipeline through one `pipeline_resume` RPC. Exit `0` on `kind: "resumed"` means the daemon admitted detached continuation, not that the pipeline finished — pair with `pipeline wait` or `pipeline list` for progress. Terminal pipelines refuse with named reasons (`pipeline_terminal_succeeded`, `pipeline_terminal_rejected`, etc.) on stderr. This is distinct from `jarvis run resume`, which resumes a paused or killed workflow run by run ID.

**Keyed-daemon auto-start:** mutating dispatch (`run start`, `run resume`,
`run workflow`, `pipeline start`) starts the daemon at the invoking digest's socket/PID/log paths
when the initial connect fails, then retries the connect under a bounded
deadline; a lost start race (`DaemonAlreadyRunningError`) is treated as reuse,
every other `startDaemon` error surfaces as a lifecycle error. Auto-start is
silent on success. Read-only commands (`run list`, `run wait`, `pipeline list`,
`pipeline wait`, `pipeline approve`, `pipeline reject`, `pipeline resume`, `tui`, `daemon status`) still report a missing daemon. The single-socket-per-digest model ensures multiple CLI instances on the same executable digest coexist on one daemon; differently-keyed daemons run independently and do not interfere.

`jarvis run list` and `jarvis run wait` pass through daemon `error` fields
verbatim when present (`reason`, `retryable`, `nextAction`); see
[`daemon-host.md`](./daemon-host.md#operator-error-on-list-and-wait) for the wire
contract. Default output is actionable summary only — no stderr dumps or log
transcripts. List rows always emit twelve columns (appended: PR evidence); scripts that parsed the prior
five-column or ten-column layout must migrate. Wait stdout includes `error` only when the daemon
result carries it (no `null` placeholder). Wait exit codes follow
`loopOutcomeKind` / `runStatus` only; `error` is informational stdout (e.g.
`retryable: true` with exit `4` on `killed`). TUI run views are unchanged in
this slice. Unreconstructible stopped write rows report
`unsupported_resume_context`, `retryable: false`, and `nextAction: stop`, and
are not resumable.

### Workflow launch modes

`jarvis run workflow <preset> ...` admits through the same validation, stale-workspace reset (when applicable), and daemon `start` path whether or not the shell stays attached. **`--detach`** opts out of client-side `wait` after admission: stdout is the workflow **entry** run ID line only and exit `0` means **admitted**, not workflow succeeded. The default attached mode prints the same run ID, then blocks on one daemon `wait` for that entry ID until workflow-terminal rollup; exit `0` on attach means the workflow finished (per [wait exit codes](#wait-exit-codes)). Intent presets may emit the same pre-run-ID stderr (`intent paths: …`) before the run ID on both modes. Observe a detached workflow via `jarvis run wait <run-id>`, `jarvis run list`, or `jarvis tui`.

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
completed work. When review runs, `complete` additionally requires the debate step to finish
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
iteration to the first unchecked linked subspec in the index. The routing base
is the external worktree when present, otherwise the registered project root on
first launch. The active linked subspec's path and body are injected into the
prompt; agent iterations execute that subspec rather than the index. After the
write loop creates the worktree, harness advancement reads and writes the
worktree's index and subspec copies only. Routing state is protected: agent-authored
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

**Implement debate review (on by default):** Omitted `--review-passes` (or project
`implement.reviewPasses` absent) appends one `review-debate` step after terminal
shrink; pass `--review-passes 0` (or set project `implement.reviewPasses: 0`) to
skip review. The step runs in the implement worktree, renders `patch.prompt.review.*`
per cycle, writes `verdict-patch.md` beside the executed index (overwritten each
cycle), and commits actuator edits through the same completion committer as
implement write edits. Empty or already-complete indexes, and any non-`complete`
implement or shrink outcome, skip the review without hard-fail.
The same completion snapshot includes the final `verdict-patch.md` verbatim,
including a zero-byte verdict. Implement review has no landing, so it records no
landing checkpoint: a publication retry re-enters the review step rather than
resuming past it. Checkpoint reuse applies to landed reviews (`plan-tree` and
`intent-stage`), and only on a retry — a fresh dispatch re-runs review.

**Workflow-started implement live control:** Implement runs launched via `jarvis run workflow implement` cannot be paused, resumed, or killed via `jarvis run pause/resume/kill`. The workflow step executes atomically to completion within the step's timeout; partial progress cannot be saved. Only `jarvis run start ...` implement runs (direct `write` mode) support live control.

## Loop outcomes

The loop classifies and routes results:

- **`progress`**: agent did useful work, not finished. Loop continues, consuming
  one of `N`. Contract is **not** checked mid-loop.
- **`done` / `no-work`**: agent claims finished. Loop checks two contracts:
  1. **`artifact.exists`**: the `--artifact` file (spec or subspec) must exist.
  2. **`spec.criteria-ticked`** (implement writes only): the active subspec's
     non-human-only acceptance criteria must all be ticked; re-reads the spec
     from the worktree to catch agent edits.
  
  All contracts pass → success (`complete`). Any fail → append `## Blocker`
  to the artifact (spec.criteria-ticked → active subspec; artifact.exists →
  routing index for linked runs) and stop (`contract_miss`). A missing terminal
  token after the one re-prompt uses the same contract checks: all pass →
  `complete` (token `done`); any fail → `invalid_token` (no `## Blocker`
  append).
- **`blocked`**: agent is blocked. Default write steps declare a
  `write.blocker-text` contract: the resolved spec file must gain a new non-empty
  `## Blocker` section during the invocation (before/after against content
  captured before spawn — presence-only is insufficient because harness-appended
  or stale blockers would pass). Satisfied → loop stops as terminal `blocked`
  (distinct from `contract_miss`). Miss → one `write.blocker-reprompt`
  (`prompts/write/blocker-reprompt.md`) over the same bindings; the write loop
  appends `blocker_reprompt` (not `token_reprompt`) with the first response text.
  Re-prompt satisfied → terminal `blocked`. Second miss → `missing_blocker`:
  loop `kind: "invocation_failure"`, `runStatus: "paused"`,
  `outcomeKind: "missing_blocker"`, `resumable: true`, exit code `2`, with
  `missing_blocker_detail` carrying the re-prompt response text. Intent-split and
  plan-draft steps omit the contract and keep today's short-circuit.
- **Budget exhausted** while still `progress`: loop exits with a soft-stop outcome
  (distinct from `blocked`, marked resumable). Re-invoking the same run resumes
  remaining spec work with a fresh per-invocation budget.
- **`invocation_failure`**: binding chain stopped without usable agent output, or
  token parse failed after a successful invocation (`invalid_token`), or a
  `blocked` token missed the blocker-text contract after re-prompt
  (`missing_blocker`). Foreground
  `jarvis write` stdout JSON uses `kind: "invocation_failure"` for all three cases;
  see below. `invalid_token` and `missing_blocker` finish `resumable: true` with durable
  `runStatus: "paused"` so re-invoking the same run resumes over the existing
  worktree.

### Binding-chain `invocation_failure` JSON

When the step result is binding-chain `invocation_failure`, stdout JSON includes:

- `failureKind` — `quota` | `model_config` | `error` | `no_binding` (see
  [`shared-invocation.md`](./shared-invocation.md))
- `bindingAttempts` — ordered `{ bindingId, resultKind }[]` summarizing each
  binding tried (`resultKind` is that attempt's `InvocationResult.kind`, except
  `"timeout"`, which marks a rung a review-role wall-clock overrun aborted rather
  than a raw `InvocationResult` variant); production rung bindings use
  `agentId/adapterModel/priceKey`

`invalid_token` also maps to loop `kind: "invocation_failure"` but **omits**
`failureKind` and `bindingAttempts`, and finishes `resumable: true`. `missing_blocker`
mirrors `invalid_token` exactly (same loop kind, paused status, resumable, no binding
detail) and adds `missing_blocker_detail` to the run log. Other
terminal outcomes (`complete`, `blocked`, `contract_miss`, `budget-exhausted`)
omit them too. Idempotent re-entry returns persisted binding-chain detail only
when the terminal attempt row has `invocation_failure_detail` stored; legacy
rows without it resume detail-free. `invalid_token` rows resume with a fresh
attempt instead of replaying the prior terminal failure.

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
- `1`: `blocked`, `contract_miss`, `completion_commit_failed`, `iteration_commit_failed`, `ready_gate_failed`, `surviving_mutation_failed`, or `ready_flip_failed`
- `2`: `invocation_failure` (binding chain or token parse failure)
- `5`: `budget-exhausted` (soft-stop, resumable per spec 02)

`completion_commit_failed`, `iteration_commit_failed`, `ready_gate_failed`, and `surviving_mutation_failed` leave the durable run
`failed` with `resumable: true`; `jarvis run resume <run-id>` may retry without
creating a duplicate commit or PR. `iteration_commit_failed` means the iteration git commit failed before `boundary_committed`; resume retries that iteration. `ready_flip_failed` is a terminal non-resumable settlement:
the run stays `completed` with `resumable: false`, and `resume` is rejected as a terminal run.
During the post-completion verification tail (ready gate, mutation verification, smoke, flip), the durable row is `in-progress` so `list` / `wait` do not report `completed` until finalization settles.

### Wait exit codes

`jarvis run wait <run-id>` sends one IPC `wait` request and resolves once per
invocation boundary (quiescent edge), not full lifecycle join. Fleet scripts
needing lifecycle success should loop `wait` until exit `0` or inspect stdout
`runStatus` / `resumable`; non-zero exit does not imply non-resumable.

When `loopOutcomeKind` is present it wins over `runStatus`:

- `0`: `complete`
- `1`: `blocked`, `contract_miss`, `completion_commit_failed`, `iteration_commit_failed`, `ready_gate_failed`, `surviving_mutation_failed`, `ready_flip_failed`, `paused`, `progress`, or any other present kind
- `2`: `invocation_failure`
- `5`: `budget-exhausted`

`completion_commit_failed` carries `runStatus: failed` and `resumable: true` on stdout; exit `1` is retryable via `jarvis run resume`.
`iteration_commit_failed` carries `runStatus: failed` and `resumable: true` on stdout; exit `1` is retryable via `jarvis run resume` (no `boundary_committed` on the failed iteration).
`ready_gate_failed` carries `runStatus: failed` and `resumable: true` on stdout; exit `1` is retryable via `jarvis run resume`.
`surviving_mutation_failed` carries `runStatus: failed`, `resumable: true`, and `error` with `reason: "surviving_mutation_failed"`, `retryable: true`, `nextAction: "resume"`, plus `survivingMutation` and source file/line; exit `1` is retryable via `jarvis run resume`.

For implement-initiated recovery only, a surviving mutation runs `write.mutation-repair` in the retained worktree. Its placeholders are `SURVIVING_MUTATION`, `SOURCE_FILE`, `SOURCE_LINE`, and `DUAL_CONSTRAINT_DETAIL`; it never invokes `patch.prompt.body`. `MAX_MUTATION_REPAIR_ATTEMPTS` is 3. Plain `jarvis run resume` has no repair binding and remains agent-free.
`ready_flip_failed` carries `runStatus: completed` and `resumable: false` on stdout; exit `1` is terminal and non-resumable.

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

### Publication titles

Every new PR resolves its title at the shared publication boundary. A readable
`index.md` uses its first non-empty H1, then its directory basename; a non-index
spec uses its file basename. Intent keeps its explicit `intent: <name>` title.
Plan output resolves only after staged output lands. The resolved title is stored
with the completion run, so retries do not reread changed or unavailable specs.
Unreadable index identity fails with a title-resolution error naming the spec path;
there is no `jarvis: complete run` fallback. Existing matching open PRs retain
their titles.

## Diff-derived mutation verification

After the scoped ready gate passes (green suite) and before the draft→ready flip,
completion verification applies mutation candidates derived from the run's
production-diff (`<runBase>...HEAD` plus untracked production files) to enforce
that changed guards are constrained by the run-base scoped test suites.

Mutation candidates are derived from changed lines by classifying patterns: fail-closed
guards (negation flips, comparison operator flips), destructive-operation safety choices
(calls to unlink/delete/etc.), and subprocess arguments. Non-production files (test files,
specs, docs) are excluded from the diff and do not generate candidates.

For each candidate: the file is mutated, scoped tests are run via `resolveCiTestScope`
against the mutated tree, and the mutation is marked "caught" only when at least one
scoped test fails. The tree is restored after each candidate regardless of outcome.
A zero-candidate diff (no production changes) or a production diff where all candidates
are caught returns a pass result carrying the run base, inspected paths, and candidate
count.

A surviving mutation (scoped tests pass under the mutation) halts verification and returns
the mutation text and source file+line. This is a non-recoverable completion failure:
the run does not report `completed` and the mutation + source site are named in completion
failure. The worktree is restored before returning any terminal result.

Application and verification scope are bounded: only changed production files are
inspected (no full-repo scan), and verification may be halted by count/time bounds
to avoid dominating implement wall-clock (future enhancement).

Verification is exercised through injected seams for git-diff, untracked-file discovery,
and scoped-test execution, enabling unit coverage of candidate derivation, mutation
application, and failure classification without live subprocess or file I/O.

## Uncovered changed-line reporter

The uncovered-changed-line reporter identifies which lines added in a run's production diff
have zero execution count in the coverage report. This advisory signal highlights code
changes that no test executes, enabling earlier detection of test gaps before they reach
the mutation verifier.

**Scope and mechanics:**

The reporter diffs the working tree against the run base using `git diff <runBase>`
plus untracked production files (same diff scope as the mutation verifier). Changed
lines are classified as production (non-test, non-spec, non-docs) and filtered to code files
(`.ts`, `.js`, `.tsx`, `.jsx`, `.mts`, `.cjs`, `.mjs` extensions). For each changed code file,
coverage is collected with exactly one scoped `bun test --coverage --coverage-reporter=lcov`
invocation over the directories implied by the changed paths (e.g., `v2`, `shared`).

Execution count is read from the LCOV output. A line added in the diff that is absent
from the LCOV data or has execution count zero is reported as uncovered. Changed code
files with no LCOV record at all have all added lines reported as uncovered.

**Fail-soft behavior:**

Coverage collection and LCOV parsing errors return an empty report rather than throwing.
This ensures an advisory signal does not fail a run: a timeout, failed subprocess, or
malformed LCOV output leaves the worktree unmodified and the run continues.

**Output:**

The reporter returns uncovered sites as file-and-line data plus rendered report text.
The text names each site as `<file>:<line>`, one per line. It does not compute or emit
any percentage, ratio, or threshold. It states that execution count zero does not imply
inadequate testing (an executed line may still lack sufficient assertions) and that the
mutation verifier, not coverage, makes the adequacy judgment.

Example output:

```
Uncovered changed lines (execution count is zero):
v2/src/execution/cleanup.ts:161
v2/src/execution/other.ts:5

Note: A line executed by tests may still lack sufficient assertions. The mutation verifier, not coverage, determines whether changes are adequately tested.
```

## Cleanup command

`jarvis cleanup` removes stale worktrees and archived incomplete specs, and reaps dead
daemon sockets. A worktree is eligible only when its PR is merged, no non-terminal
durable run references it, and the daemon reports no live run for it. Stranded
artifacts are complete specs without a materialized owner.

The command enumerates `daemon-*.sock` files under `~/.jarvis/`, probing each with
a connect attempt to classify liveness. Sockets whose probe receives `ECONNREFUSED` or
`ENOENT` are classified dead and removed; all other probe results (success, timeout,
permission error, unexpected error) preserve the socket and are reported. Multiple
daemons keyed by different executable digests may coexist, so each discovered socket
is classified independently; live sockets are never removed regardless of which daemon
owns them. When the jarvis home cannot be enumerated, no sockets are removed in that
cleanup run.

`jarvis cleanup` with `--dry-run` previews worktrees, artifacts, and dead sockets
without removal. Open-home stranded archival preview adjusts materialized-worktree
ownership by excluding retire-preview worktrees; apply re-inspects stranded ownership
after successful retirements only (failed retirements leave owners materialized, so stranded
dry-run can overshoot apply). The confirmation prompt counts all removal candidates; a cleanup run
whose only work is dead sockets still prompts and proceeds rather than reporting
nothing to clean up.
