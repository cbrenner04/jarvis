# v2 operator runbook

Reference for the **operator** driving the primary v2 harness (`jarvis`) on the
Jarvis repo. **Operator** is the single name for this role.

Scope: **Jarvis-on-Jarvis v2 workflows** — daemon-backed `jarvis run …`, workflow
presets, TUI observation, and cleanup. Cross-link the v1 runbook for the few
surfaces v2 does not own yet.

## Which binary

`jarvis` (v2) is the daily driver: intent/plan/implement workflows, daemon, run
control, TUI, and cleanup of v2 worktrees/specs. `jarvis1` (v1,
maintenance-only) remains for:

| Concern | Binary | Notes |
| --- | --- | --- |
| Project registry (`jarvis1 init`, `jarvis1 config`) | `jarvis1` | v2 reads the same `~/.jarvis/config.json` |
| Triage, review-feedback, prompt, runbook add | `jarvis1` | `triage --merge` gates spec-backed and spec-less PRs; see [v1 operator runbook](../../v1/docs/operator-runbook.md) |
| v1 patch runs (`jarvis1 run <spec>`) + their log server | `jarvis1` | Fallback only; `jarvis1 cleanup` owns v1 worktrees/specs |

Orientation: [`onboarding.md`](./onboarding.md). Install path:
[`install-and-config.md`](./install-and-config.md).

## Where planning artifacts live

Check live `~/.jarvis/config.json` for `plan.targetDir`. For the jarvis project
that is `v2/spec` (the default); v1 maintenance fixes use `--target-dir v1/spec`.

| Artifact | Typical path |
| --- | --- |
| Seeds (open-work queue) | `<targetDir>/seeds/` (v2 seeds: `v2/spec/seeds/`) |
| Ready intents (open-work queue) | `<targetDir>/ready-intents/` |
| Active specs | `<targetDir>/<UTC-timestamp>-<name>/` |
| Completed specs | `<targetDir>/completed/` |
| Operator scratch notes | repo `.scratch/` (gitignored) |

Prioritization for seeds and ready intents (operator-maintained):
`v2/spec/implement-queue.md`.

Successful publication consumes the queue input only after its durable output
lands; see the [workflow publication contract](./workflow-runner.md#publication-landing).

## Status

**v2 is the primary harness.** `intent`, `plan`, and `implement` are the
first-class presets; `implement` launches only when its requested spec tree has
unchecked automated work. **Configured pipelines** are supported for registered
projects whose `~/.jarvis/config.json` entry includes `projects.<name>.pipeline`
(admission resolves the named definition and `terminalAction` before
`pipeline_start`). Step-by-step operator flow for `full-review` with approval
gates, failure resume, and terminal `ready` settlement lives in
[Configured pipeline (`jarvis pipeline start`)](./first-workflow-walkthrough.md#configured-pipeline-jarvis-pipeline-start).
`intent-reviewed`, `plan-reviewed`, and
`plan-reviewed-light` are **legacy aliases** (see
[Workflow presets](#workflow-presets-registered-names)), not first-class
presets.

Intent-reviewed dispatch now resolves the registered layered critic and actuator
artifacts at runtime, reading every staged Markdown file and spec guidance. The
critic's stdout remains the verdict channel and is persisted at the reserved verdict
path; empty verdicts skip the actuator. Completion requires that critic invocation
and artifact; missing staged workspaces, unavailable bindings, boundary violations,
and Git inspection errors now stop with named failures instead of silently completing.
Boundary violation messages list unauthorized repo-relative paths verbatim.

**Two diagnoses of this have already been wrong — do not cut a spec against a third
without observing a run.** "The review step never invokes an agent" is refuted:
telemetry shows real critic *and* actuator invocations (21–83s, `exit_kind: ok`).
Bare `intent` now runs one light review by default; pass `--review-passes 0` to
recover split-only completion for scripts that relied on the prior zero-pass default.
Bare `plan` now runs one debate review by default; pass `--review-passes 0` to
recover draft-only completion for scripts that relied on the prior zero-pass default.
Note an empty review log proves nothing either way: `runReviewStep` gets no `logSink`,
so it logs nothing whether or not an agent ran. Both wrong diagnoses read that silence
as evidence. Ready-intent: `review-step-emits-log-events`.

**Do not trust a `completed` status on a P0 without re-running the preset.** Two of
them (`implement-preflight-validates-spec-in-missing-worktree` #1417,
`plan-draft-write-loop-prompt`) were marked complete while the operator-visible
failure survived — the fix landed one layer away from the bug.

## North star

Same as [v1 operator runbook § North star](../../v1/docs/operator-runbook.md#north-star):
minimize manual steps; fold fixes into existing commands rather than new subcommands.
Gaps become seeds under `v2/spec/seeds/` (or `v1/spec/seeds/` for genuine v1
maintenance fixes).

## Operator feedback cadence

Same two-point rule as v1: report when you launch a `jarvis` command and when it
lands. After a landed intent (implemented and on `main`), one short session
paragraph. Interrupt only for a decision you cannot make.

## Operator responsibilities

Adapted from v1; v2 session close-out is the same obligation:

1. **Drive + review + merge** v2 work through the normal PR path.
2. **Seed harness gaps** surfaced while dogfooding — link stopgaps in this runbook
   to the seed and a cleanup trigger.
3. **Triage harness suggestions** ([v1 runbook § Harness suggestions](../../v1/docs/operator-runbook.md#harness-suggestions-from-other-repos)).
4. **Session report** under `reports/` with UTC timestamp; link every implementation
   PR.
5. **Maintain this runbook** (branch → PR → merge). Operators add gotchas and remove
   entries when the structural fix ships.
6. **End-of-session cleanup** — `jarvis cleanup` retires merged v2 worktrees, prunes eligible merged
   local heads and local `origin` tracking refs (never a remote branch), and scans each registered
   `v2/spec/` home for completed stranded specs (`--dry-run` to preview, `[y/N]` to confirm). When the
   owning worktree is retired in the same apply run, open-home stranded specs archive in that pass.
   It retains
   unmerged/leaked worktrees for manual recovery (see [Recovery](#recovery)). A stranded spec is owned only by
   a discovered managed worktree in the same registered project on its recorded implementation branch; primary
   checkouts and other resolved branches do not own it. Cleanup rechecks ownership immediately before archival,
   and refuses archival when a same-project managed worktree has an unresolved or detached branch.

## Runbook maintenance

v2 has no `jarvis runbook add` command. Edit this file directly:

1. Work on a git worktree (not the primary checkout).
2. Add dated bullets under **Known gotchas** or **Recovery** — terse, actionable.
3. When a seed fixes a gotcha, delete the bullet and note the seed in the PR that
   removes it.
4. Open a PR; do not commit runbook-only changes inside an agent spec run (they
   get absorbed by `git add -A`).

Template for a new gotcha:

```md
- **Short title (YYYY-MM-DD):** what happened, what to do. Seed: `v2/spec/seeds/<name>.md`.
  Cleanup: delete this bullet when `<name>` merges.
```

## Session start

1. `jarvis daemon status` — start with `jarvis daemon start` if stopped.
2. `jarvis config show` — agents listed; `machineProfile` hand-edited in
   `~/.jarvis/config.json` (see [`install-and-config.md`](./install-and-config.md)).
3. Register the jarvis repo if needed: `jarvis1 init` from the project root.
4. Read `v2/spec/implement-queue.md` for current gates.
5. Sweep open [harness-suggestion issues](https://github.com/cbrenner04/jarvis/issues?q=label%3Aharness-suggestion+is%3Aopen)
   — **and read their comments.**

**Issue comments are not returned by default.** `gh issue list` gives titles only, and
`gh issue view <n>` omits comments unless you ask for them. The owner routinely adds
decisive context as a comment after filing, so triaging from the body alone will get
it wrong:

```sh
gh issue view <n> --repo cbrenner04/jarvis --comments
```

Observed 2026-07-12 on intake #1453: the body proposed a full sandbox-policy
architecture; the owner's comment said *"written with no familiarity with the harness
— confirm assumptions prior to creating a seed."* Three core assumptions then failed
against the code, and the resulting seed was a fraction of what the body asked for.
See [v1 runbook § Triage](../../v1/docs/operator-runbook.md#triage-jarvis-on-jarvis-operator).

## Core operator paths

Full happy-path detail: [`first-workflow-walkthrough.md`](./first-workflow-walkthrough.md).
Preset contracts: [`workflow-runner.md`](./workflow-runner.md).

### Daemon lifecycle

```sh
jarvis daemon start
jarvis daemon status    # running → exit 0
jarvis daemon stop      # when intentionally shutting down
```

Socket: `~/.jarvis/daemon.sock`. Process log: `~/.jarvis/daemon.log` (no
`jarvis daemon log` subcommand yet — ready intent `daemon-process-log-read`).

### Workflow presets (registered names)

| Preset | Purpose |
| --- | --- |
| `intent` | Split seed → `ready-intents/` (one light review by default; `--review-passes 0` opts out) |
| `plan` | Draft spec tree from ready-intent (one debate review by default; `--review-passes 0` opts out) |
| `implement` | Index-routed implementation + shrink (+ review by default; `--review-passes 0` to skip) |

`intent-reviewed`, `plan-reviewed`, and `plan-reviewed-light` are **legacy
aliases** (`LEGACY_WORKFLOW_ALIASES`, `v2/src/commands/workflow-args.ts`) that
resolve to `intent`/`plan` and emit a migration hint. `intent-reviewed` and
`plan-reviewed` are redundant with bare `intent` and `plan`.

Examples:

```sh
jarvis run workflow intent --seed v2/spec/seeds/my-seed.md
jarvis run workflow intent --seed v2/spec/seeds/my-seed.md --review-passes 0  # split-only
jarvis run workflow intent --seed v2/spec/seeds/my-seed.md --review-behavior debate
jarvis run workflow plan --ready-intent v2/spec/ready-intents/my-intent.md
jarvis run workflow plan --ready-intent v2/spec/ready-intents/my-intent.md --review-passes 0  # draft-only
jarvis run workflow implement --base main --spec v2/spec/<spec>/index.md
# omit review: jarvis run workflow implement --base main --spec v2/spec/<spec>/index.md --review-passes 0
jarvis run workflow implement --base main --spec v2/spec/<spec>/index.md --detach  # return after admission; track via printed run ID
```

### Pipeline start

Launch a registered project's configured pipeline when `projects.<name>.pipeline` is present and valid in machine config (`jarvis run workflow implement` ignores `pipeline` entirely):

```sh
jarvis pipeline start <project> --seed-text "Ship feature"
jarvis pipeline start <project> --seed path/to/seed.md
jarvis pipeline start <project> --seed-text "Ship feature" --detach  # return after admission; track via printed pipeline ID
```

`--seed <path>` matches standalone intent `--seed` (slug, `landing.inputs.paths`, worktree consumption);
`--seed-text` is inline-only (`seedText`, no seed-file deletion).

**Detach vs attached:** `--detach` runs the same pre-admission validation and daemon `pipeline_start` path as the default attached launch. Detached stdout is the admitted pipeline ID only; exit **`0` means admitted**, not that the pipeline finished. Attached mode loops `pipeline_wait` through `awaiting-approval` boundaries until a terminal state, then prints `{kind:"terminal",state}` JSON.

### Pipeline list and wait

After a detached start, poll progress with list or block on boundaries with wait:

```sh
jarvis pipeline list                              # one JSON snapshot; does not follow live work
jarvis pipeline wait <pipeline-id>                # block until terminal or awaiting-approval
```

`jarvis pipeline list` mirrors daemon `pipeline_list` in one stdout line (`pipelineId`, `name`, derived `state`, ordered stages with `stageId`/`branchKey`/`status`/`workflowInvocationId`/`startedAt`/`endedAt`). The CLI issues a single non-blocking snapshot RPC with no client-side polling — use it for point-in-time snapshots, not completion tracking. Typical end-to-end latency stays within the daemon's **500ms** snapshot bound even when pipelines are still running (`daemon-pipeline-observation.test.ts`); the CLI does not enforce that ceiling by waiting or polling.

`jarvis pipeline wait` prints one boundary JSON line per invocation. Exit **`0`** on `awaiting-approval` or terminal `succeeded`; non-zero on other terminal states. Approval boundaries name `{kind:"awaiting-approval",stageId,branchKey}`. Re-run wait after approving a gate; attached start loops internally instead. Operator abort (SIGINT) during wait follows the same pattern as `jarvis run wait`: stderr connection detail, non-zero exit, no boundary JSON on stdout.

### Pipeline approve and reject

Read the deciding `stageId` and `branchKey` from `pipeline wait` boundary JSON (`{kind:"awaiting-approval",stageId,branchKey}`) or from `pipeline list` stage rows (`status: "awaiting"`). Admit or reject the named branch gate:

```sh
jarvis pipeline approve <pipeline-id> <stage-id> <branch-key>
jarvis pipeline reject <pipeline-id> <stage-id> <branch-key>
```

Single-default-branch pipelines use `branchKey: "default"`. After an intent split, each branch row carries its own `branchKey` — approve or reject one branch without affecting sibling gates. Post-approve successor dispatch is scoped to the approved `branchKey` only: sibling gates stay `awaiting` and sibling stages are not dispatched until their own gate is approved. Exit **`0`** on `kind: "applied"` means the decision was durably admitted, not that the pipeline finished — pair with `pipeline wait` or `pipeline list` for progress. Refused duplicate or stale decisions (`invalid_decision`, `status_not_awaiting`, `branch_key_required`, etc.) print the daemon `reason` verbatim on stderr and exit non-zero with no success stdout. Re-run `pipeline wait` after a successful approve to observe the next boundary.

### Pipeline resume

Re-enter a failed or `awaiting-approval` pipeline without starting a new one:

```sh
jarvis pipeline resume <pipeline-id>
```

Use **`pipeline resume`** (not `pipeline start` or `jarvis run resume`) when a pipeline stalled at a failed stage or an approval gate and you want the daemon to reopen or claim continuation from persisted admission context. Exit **`0`** on `kind: "resumed"` means the daemon admitted detached continuation, not that the pipeline finished — pair with `pipeline wait` or `pipeline list` for progress. Terminal pipelines (`pipeline_terminal_succeeded`, `pipeline_terminal_rejected`) and other refusals print the daemon `reason` verbatim on stderr and exit non-zero. Failed resume replays from the failed stage (preserving predecessor invocation IDs); awaiting resume claims the pipeline without dispatching past the gate — approve the gate separately, then `pipeline wait`.

Append **`--detach`** to any preset invocation when the shell should not block on workflow completion. Detach runs the same admission path as the default attached launch; stdout is the workflow **entry** run ID only and exit **`0` means admitted**, not that the workflow succeeded. Use `jarvis run wait <run-id>`, `jarvis run list`, or `jarvis tui` on that ID for progress and terminal outcome. Attached mode (no `--detach`) keeps the shell open through entry-terminal `wait`; exit `0` there means the workflow finished.

`--spec` is resolved from the caller's cwd, then checked at its resolved
project-relative path in `--base` before daemon contact. If it is unavailable,
commit or select a base ref that contains the spec and retry; launching from a
project subdirectory is supported.

Before linked routing, the daemon materializes and validates the managed
worktree. If that fails, it returns `worktree_materialization_failed`; the
message names the managed path and the underlying Git or validation reason. Fix
the checkout problem and retry: no routing read, run row, or agent invocation
occurred. A later routing index read returns `routing_read_failed`; its message
names the resolved index path and underlying read reason.

Remote branch presence for materialization uses `git ls-remote --heads origin
<branch>` (`branchExistsOnOriginAsync` in `shared/git.ts`), not a local
`origin/<branch>` tracking ref alone. `ls-remote` errors or empty output are
treated as absent on the remote (fail-closed false), so offline or auth failure
can bias recreation toward `--base` even when a remote branch still exists.

Before daemon contact, `jarvis run workflow implement` reads the requested spec
tree. If all non-human-only criteria are checked, it exits `1` with
`implement.already_complete`; no worktree, agent invocation, or run row exists.
Linked-index checkboxes are not the completion source of truth.

On an incomplete re-run with git enabled, preflight retires a stale workspace for
the resolved `(project, branch)` after daemon connect and before the write step
starts, in this order: remove the materialized worktree, delete the local branch,
delete the remote branch, prune a stale `origin/<branch>` remote-tracking ref when
it still resolves locally, then close the matching open draft PR (when exactly one
exists). Implement rematerializes from its explicit `--base`; plan rematerializes
from its resolved repository base. The sequence aborts at the first failing step.
First runs with no existing worktree skip this path.

Two kinds of `1` exit come out of this path, and they are not the same state:

- **Pre-mutation refusal** — nothing was touched. Raised when the workspace is
  live-held, the matching PR is ready (non-draft), multiple open PRs match the
  branch, the daemon already holds the `(project, branch)` claim that would
  refuse workflow `start` (`worktree_claimed:` on stderr; worktree, local and
  remote branches, and open PR stay intact), the daemon claim-check RPC fails
  (generic `Cannot re-run incomplete spec:` wrapper — not `worktree_claimed:`;
  no retirement), or the materialized worktree has uncommitted tracked or
  untracked paths;
  stderr names the blocking state (for a dirty worktree, paths and recovery:
  commit, discard local changes, pass `--reset-despite-dirty` on the incomplete
  re-run to retire despite local edits (listing failure still refuses), or run
  `jarvis cleanup --abandon <branch>` outside a re-run). The same dirty-worktree
  gate applies to incomplete git-enabled `jarvis run workflow
  plan` re-runs (shared `resetStaleWorkspace` preflight). Recovery: end the live
  run or wait for its lock to clear; mark the PR draft again or merge it; close
  duplicate PRs until exactly one open draft remains; or clean the worktree as
  named in the refusal, then re-run. Manual fallback: `jarvis cleanup --abandon
  <branch>` when guards pass.
- **Partial teardown** — stderr reads `retirement failed at <step>; <what
  remains>`. Local artifacts may already be gone. Finish the teardown by hand (see
  [`--abandon`](#v2-debris-blocks-the-jarvis1-fallback) for the per-step remnants
  and commands), then re-run. When any retirement step destroyed artifacts before
  the invocation exits non-zero, stderr also prints a `Retirement destroyed
  artifacts:` block listing each destruction event from this invocation (closed PR
  number, worktree path, local branch, remote branch, pruned remote-tracking ref) — not a live re-probe of git
  or GitHub. A started run may have recreated the worktree and branch after
  retirement; treat the summary as a teardown log, not current state. Because the
  guard now runs after connect, a refused re-run leaves behind the daemon it
  auto-started when none was listening — stop it with `jarvis daemon stop` if you
  did not want one up.

### Ad-hoc write loop (live pause/kill)

`jarvis run start` with explicit worktree fields — supports `pause` / `kill` /
`resume` on the active run. Workflow-started implement supports live `kill` only;
`pause` / `resume` remain write-loop-only. See
[first-workflow-walkthrough § Workflow-started implement](./first-workflow-walkthrough.md#workflow-started-implement)
and [`daemon-host.md` § Live controls](./daemon-host.md#live-controls-on-workflow-started-runs).

### Observe

| Command | Use |
| --- | --- |
| `jarvis tui` | Split-pane run monitor (stacked below 120 cols): left pipeline tree (pipeline → stage → run) plus unattributed runs and queue, right pane by selection kind (pipeline/stage metadata or run workflow/outcome/steering), 4-line dock (`[`/`]` nudge divider); **`j`** or ↓/↑ walk tree plus unattributed rows (queue display-only); **`e`** expands/collapses selected pipeline or stage; kill (`k`) on live runs |
| `jarvis run list` | JSON-ish run rows; `isLive` vs durable `status` |
| `jarvis run list --since <duration\|timestamp>` | History query past the default fifty-terminal-run window; duration units `d`/`h`/`m`/`s` (e.g. `2d`, `90m`) or absolute Unix ms / ISO 8601 |
| `jarvis run list --project <name>` | Exact durable `project` match (case-sensitive); bypasses the fifty-terminal-run retention window |
| `jarvis run list --branch <name>` | Exact durable `branch` match (case-sensitive); bypasses retention |
| `jarvis run list --spec <path>` | Exact durable `spec_path` match (case-sensitive); bypasses retention |
| `jarvis run list --status <terminal-status>` | Exact terminal durable status (`completed`, `failed`, `blocked`, `interrupted`, `killed`); bypasses retention |
| `jarvis run list --since … [--limit <n>]` | Filtered history query: optional `--limit` caps matching rows (default **200** newest when omitted); dimension flags compose conjunctively with each other and with `--since` |
| `jarvis run list --limit <n>` | Without a filter, the daemon does not use `limit` to reduce rows: row count and retention match plain `jarvis run list` (fifty-newest terminal policy). The CLI still passes `limit` on the RPC; the retention path ignores it |
| `jarvis run wait <run-id>` | Block until next boundary |
| `jarvis run log <run-id>` | Structured run log (not daemon process log); snapshot only — replays persisted records and exits once the daemon closes the stream, even for a live run |
| `jarvis run log <run-id> --follow` | Same replay, then keeps tailing new records until the daemon closes the stream — which happens automatically once the followed run settles — or the client disconnects |
| `jarvis tui log <run-id>` | Interactive tail; reads across live keyed daemons (auto-discovers owner) |

`list` / `wait` operator errors: [`daemon-host.md` § Operator error](./daemon-host.md#operator-error-on-list-and-wait). `contract_miss` rows also expose `error.contractMissDetail` when the run log's chronologically last `contract_miss_detail` event carries `failureReason` (plan-draft normalizer text, for example); `jarvis run log` remains the full excerpt. Omitted when the log tail cannot be read (store-only / no `logReader`).

**Overlapping daemons after rebuild:** When the executable is rebuilt, a new daemon with a different digest starts and automatically sends `supersede` to every other keyed daemon socket (best-effort, fire-and-forget after the new daemon's server is listening). A superseded daemon continues answering on its socket but stops admitting new `start` and `resume` requests (rejected with code `daemon_superseded`). Runs launched by a superseded daemon remain in-progress until settled; once settled, the daemon disappears on its own as callers switch to the new keyed socket. No manual stop command is needed.

**TUI cross-daemon observation:** `jarvis tui` and `jarvis tui log` are the primary observation surfaces for multiple daemon instances. When dispatch moves to a new digest (via recompiled executable), the TUI automatically discovers and displays runs from both the old (superseded) and new (superseding) daemons on its next refresh tick. No restart is required. Once the old daemon exits naturally, its runs are removed, and the monitor continues uninterrupted. `jarvis tui log <run-id>` auto-discovers the run's owner daemon across all live instances; when invoked, it discovers live sockets, queries each daemon's run list to locate the owning daemon (preferring live runs), and tails from that owner. `jarvis run list` queries every live keyed daemon under `JARVIS_HOME` and merges their run lists, deduping by run ID and preferring rows marked `isLive` by the owning daemon. A merge no longer blinds `run list`, `run log`, or `run wait` after digest transitions.

**Transport loss recovery in `jarvis tui log`:** When a mid-stream transport loss occurs (daemon restart, network hiccup), the tail automatically re-opens against the live owner socket and resumes from the last appended record sequence, avoiding duplicate output. Recovery is transparent—no operator action is required and no records are lost or duplicated. If reconnection attempts are exhausted (default: 5 retries with exponential backoff, 100 ms to 2 s), the session shows `tail_resume_exhausted` error feedback and exits with code 1. Operator quit during a retry wait returns cleanly with exit code 0.

The invoking-socket client (the socket TUI connects to by default via `deps.socketPath`) is no longer exempt from eviction. When that connection's `list()` RPC fails, the stale client is closed and removed, allowing a fresh connection on the next refresh tick. This ensures that if the invoking daemon dies and a new daemon binds the same socket path, the TUI automatically reconnects to the new daemon's runs.

Use `jarvis tui` for the live window. The left pane nests daemon `pipeline_list` snapshots into a three-deep tree (pipeline → stage → workflow run), then unattributed runs, then a queue block. **`j`** or ↓/↑ walk every selectable tree and unattributed row in pane order — queue rows are display-only and are not walk targets. When the tree exceeds the pane height, walk order still spans all selectables and the viewport scrolls to keep the selected tree row visible. **`e`** toggles expansion for the selected pipeline or stage; **`e`** on a run leaf or unattributed row is a no-op. On a selected stage, **`e`** toggles between collapsed representative run rows and expanded constituent rows. Selecting a descendant reveals ancestor rows for paint without persisting toggle expansion; walking into a collapsed pipeline or stage with ↓ expands it for the session via the same `expandedPipelineNodeIds` store as **`e`**. Pipeline-attributed runs join under their stage with no one-hour / twenty-row cap; the live window and twenty-row cap apply only to the **unattributed** segment below the tree (terminal runs finished within the last hour, `finishedAtMs` from attempt `completed_at` and store `reconciledAt` when present, newest first). Terminal rows lacking any finish timestamp stay in the live window. `blocked` rows older than one hour drop from the TUI — recover with `jarvis run list --status blocked --since …` (or other list filters). Older terminal runs still appear in daemon `list` payloads and in `jarvis run list`; query history with `jarvis run list --since 2d` (or `90m`, `2026-07-01T00:00:00Z`, etc.) or narrow by durable dimensions, for example `jarvis run list --project my-repo --status completed` or `jarvis run list --branch feature/foo --spec v2/spec/index.md`; returned run IDs work with `run log` and `tui log` across live keyed daemons (each resolves the owner). Large filtered queries default to the **200** newest matches per keyed daemon `list` response before `jarvis run list` merges sockets; merged CLI output can exceed **200** when multiple live daemons each return matches. Pass `--limit 50` (for example) when you need fewer rows per daemon.

Durable state: `~/.jarvis/state/v2.sqlite` ([`state-store.md`](./state-store.md)).

### Worktrees and branches

v2 git-enabled workflows use `~/.jarvis/worktrees/<project>/<branch>/`, not
`<repo>/.worktree/`. Intent branches: `intent/<slug>`. Plan branches: `plan/<name>`.
Implement branch defaults to the spec directory basename.

Merged worktrees and eligible merged local branch refs are retired by `jarvis cleanup` (see
[Cleanup: eligibility gate](#cleanup-eligibility-gate)). A leaked worktree from a **failed/unmerged** run
is reset automatically on the next incomplete `jarvis run workflow implement` or `plan` re-run (see above);
for manual cleanup when guards pass, use `jarvis cleanup --abandon <branch>`.

If a failed materialization leaves an ordinary directory at its managed path, retry the workflow:
v2 removes that proven unregistered non-Git husk and rematerializes it under the same branch lock.
It refuses and leaves the path intact when Git recognizes it as a worktree, the target repository
still registers it, or Git ownership/validation is inconclusive; inspect that state before manual removal.
Incomplete implement and plan re-dispatches defer this non-Git husk to locked materialization,
with or without `--reset-despite-dirty`. Other `git status` listing failures still refuse before
any retirement; the override applies only to a successful dirty listing.

## Implementation on jarvis specs

Two valid paths:

1. **`jarvis run workflow implement`** — the primary path; live `jarvis run kill`
   stops an in-flight write step; verify preflight and gates independently.
2. **`jarvis1 run <spec>`** — v1 maintenance fallback (patch loop, triage,
   cleanup integration).

Do not assume parity between them — see [Gate trust](#gate-trust) for what the v2 gate covers.

A review step whose role invocation exceeds its per-role wall-clock bound escalates
internally to the next configured rung (agent/model binding) in the flat list — same
as a quota fallback — before settling anything on the run row. The wall clock and
idle budget are armed once per escalation **segment** (one `executeWithQuotaFallback`
call over the remaining binding suffix), not once per rung: a rung reached by
in-segment quota advancement shares the rest of that segment's clock rather than
starting a fresh timer; only a rung that starts a new segment (after a prior segment
timed out) gets a full fresh `roleTimeoutMs`. Worst-case wall time for one role
invocation is bounded by segment count and is N × bound across N configured rungs
only when every rung times out with no in-segment quota advancement between them.

Only after **every** configured rung times out (including a single-binding list) does
the step settle `invocation_failure` with `failureKind: "timeout"`, `exhaustedRoleTimeout: true`,
and `bindingAttempts` naming every rung tried in profile order (`bindingId`, `agent`,
`model`, and `resultKind` — the rung(s) actually aborted by the wall clock report
`"timeout"`; a rung consumed by quota before the abort reports its real result kind,
e.g. `"quota"`). A mixed quota/timeout outcome keeps `exhaustedRoleTimeout: false`
and the retryable `role_timeout`/`retry_later` mapping instead — the deterministic-wall
argument for `stop` only holds when every rung genuinely timed out; a quota-consumed
rung may succeed on re-dispatch. An exhausted settle is terminal: `resumable: false`,
`jarvis run list` / `wait` report `error.reason: "role_timeout"`, `retryable: false`,
`nextAction: "stop"` (distinct from write-loop `iteration_timeout`). It reproduces
deterministically — a re-dispatch just spends the same N × bound to reach the same wall
again — so recovery is changing the rung config (raise the bound, add/reorder rungs) and
starting a fresh run, **not** re-dispatching the same workflow and **not** `jarvis run
resume` (which hard-errors on a `failed` run that is not publication-retry-eligible).
Inspect the worktree first — the aborted actuator's partial edits are still on disk, and
they are **not** swept into any later completion commit: the dirty-worktree gate refuses
a fresh run over the same worktree, and `--reset-despite-dirty` discards them. Salvage
anything worth keeping before starting fresh.

That review re-dispatch path does not re-resolve implement write-step bindings — only
write-loop `resume`, recovery, queue promotion, and fresh write admission pick up a rung
edit (confirm via attempt telemetry until `jarvis run list` reports binding).

An idle-output watchdog on the same review-role invocation times out when a role
produces no output for the machine-wide `idleOutputTimeoutMs` budget: a configured
positive value arms it, an absent key uses the 90_000 ms fallback, and `0` disables
it. A stall settles `invocation_failure` with `failureKind: "stall"` and reports
`error.reason: "role_stalled"`.
Unlike `role_timeout` (wall-clock from start), `role_stalled` reflects hung output,
does not escalate through rungs, and is retryable (`retry_later`); recovery is
re-dispatching the same workflow (see [Gate trust](#gate-trust)) — unlike an exhausted
`role_timeout`, which is not. The write path's own idle-output watchdog settles a
distinct, non-retryable `idle_output_timeout` (`error.reason: "idle_output_timeout"`,
`nextAction: "stop"`) on write-step/reprompt invocations; see the 2026-07-25 entry
above.

**Actuator-only retry (`review-debate` patch review):** admitted only for a
post-commit retryable failure kind — today that is exhausted-rung-exempt `role_stalled`;
an exhausted `role_timeout` is not retryable, so it never reaches this path (it settles
`resumable: false` and falls through to a full debate replay on re-dispatch, same as any
other non-retryable failure). When the failed role was specifically the **actuator** on a
`review-debate` step and the failure kind is admitted — the debate roles already
settled a verdict at `verdictPath` before the actuator ran — re-dispatch does not
replay the adversary/advocate/adjudicator chain or the hidden `~shrink` pass. It
reuses the same review run row and re-invokes only the actuator against the
persisted verdict, so recovery is a single role invocation. This is distinct from a
debate-role failure (adversary, advocate, or adjudicator), which always re-dispatches
the full debate cycle on a fresh run row. If `verdictPath` is missing or empty at retry time (e.g.
a worktree reset removed it), the re-dispatch settles a named, non-retryable
error instead of silently falling back to a full debate or full workflow re-run.
That settled failure carries no actuator role, so the *next* re-dispatch is no
longer actuator-only eligible — it replays the full debate cycle on a fresh run
row, which regenerates the verdict itself. No manual verdict recreation is
needed; just re-dispatch (or abandon and start fresh).

Multi-cycle review (`reviewPasses` > 1) never takes the actuator-only path,
even when the last attempt failed at the actuator — an intermediate cycle's
actuator failure would otherwise retry that one actuator and report the step
complete, silently dropping the remaining cycles. Recovery for multi-cycle
review is always the full debate cycle described above.

The reused run row keeps the workflow snapshot from the original dispatch, so
a config edit between dispatches is not picked up by actuator-only retry —
same trap as the "review re-dispatch does not re-resolve implement write-step
bindings" caveat above.

## Gate trust

Post-commit review `role_stalled` (`failureKind: "stall"`) preserves the completion commit and
adjudicated verdict on disk; recovery is re-dispatching the same workflow, not
`jarvis run resume`. An exhausted `role_timeout` also preserves the completion commit and
verdict, but is not resumable and not worth re-dispatching — see above.

`jarvis run list` / `wait` project `resumable` from the same admission predicate as `jarvis run resume`
(`nextAction: "resume"` on the composed operator error). A row advertising `resumable: true` is admitted;
a `terminal_run` refusal names the owning recovery for the composed `error.reason`, not only the durable
status.

The v2 ready gate runs the `full` tier (`check`, `typecheck`, tests, `lint:md`) unconditionally,
overriding any `JARVIS_READY_TIER` in the parent environment. The `lint:md` step covers all v2
markdown: `v2/docs/**/*.md` and `v2/spec/**/*.md`, subject to the shared ignores (`**/completed/**`,
`**/verdict-*.md`). The test step is base-scoped: a diff of `<baseRef>...HEAD` (three-dot, merge-base
relative) is classified via the shared classifier, and the resolved scope is passed as
`JARVIS_READY_TEST_SCOPE` (e.g., `test:v2 test:integration:v2` when only v2 changed, or `full` for root
tooling/shared changes). When the diff fails (unresolvable base ref), the test scope falls back to `full`
and finalization proceeds rather than erroring. Non-test steps (`check`, `typecheck`, `lint:md`) and the
`full` tier remain unchanged.

`jarvis1 run` must not report success when the ready gate is red (seed
`run-cannot-report-complete-over-red-gate`). Treat `criteria-complete` exit 0 as
insufficient without a green gate on the branch head.

The full aggregate `bun run test` wall clock is currently 326s (mean, 321-330s range, measured
2026-07-26) — down from a 697s pre-change baseline — because the runner now executes independent
test files concurrently instead of serially. A gate run's test steps see this figure only when
`JARVIS_READY_TEST_SCOPE` resolves to `full`; a scoped run (see above) executes a slice subset and
runs faster. That concurrency means the gate deliberately saturates the machine it runs on by
design; on an already-loaded operator machine, a gate failure is worth one re-run before trusting
it, and `JARVIS_TEST_CONCURRENCY` is the lever to lower if load contention is the suspected cause
(see [test-writing.md § Bounded concurrency pool](./test-writing.md#bounded-concurrency-pool)).

A red ready gate first runs project autofix once per repair entry (after the repair fence freezes, before any repair agent): configured `fixCommand` or built-in `bun run fix`, fence-validated commit with `Jarvis-Ready-Gate: autofix`, republish, and re-gate — without charging repair iterations or the iteration budget. Autofix failure settles retryable `completion_commit_failed` without agent repair; a still-red gate after successful autofix enters up to three bounded repair iterations. Each repair consumes the iteration budget and republishes before the gate is rerun. When every non-timeout repair attempt stays red, the run settles `failed` with `ready_gate_failed`, `resumable: true`, and terminal
`loop_finished` evidence `readyGateOrigin: repair_budget_exhausted` plus `readyGateRepairCount: 3`.
That row retains its publication checkpoint (completion attribution and draft-PR evidence) and admits
`jarvis run resume` on a gate-only finalization tail — no write-agent re-entry and no additional
`ready_gate_repair` events. Other `ready_gate_failed` rows (blocked repair, iteration-limit
suppression, deadline timeout, or missing/mismatched checkpoint) keep their existing resume paths or
refusals. A deadline-killed gate (exit code 124 or
`ready: deadline exceeded after Nms (step budget|run ceiling, step: <name>)` in the captured output) skips repair,
logs `ready_gate_timeout`, and settles immediately for `jarvis run resume`. This is a budget kill, not a red gate:
the gate passed locally and timed out against either a per-step budget or the overall run ceiling (see
[test-writing.md § Ready-gate step budgets](./test-writing.md#ready-gate-step-budgets); `shared/**` changes can hit
this from running all three test slices). Because per-step budgets are fixed constants in `scripts/ready.ts`
(no per-step env knob), a step-budget kill needs that constant raised, not a resume — resume only helps when the
**run ceiling** (`JARVIS_READY_TIMEOUT_MS`) bound instead. Flip failures are not repaired; resume a
`ready_gate_failed` or `surviving_mutation_failed` run after fixing coverage. For `ready_flip_failed`, manually fix
the PR draft → ready transition (see [Publication / completion failures](#publication--completion-failures)); do
not `jarvis run resume`.

When every attributable failing path lies outside the run's touched set (spec tree plus base-to-HEAD
diff and untracked inventory), finalization settles `ready_gate_out_of_scope` instead of entering
bounded repair. `list` / `wait` name `error.reason: ready_gate_out_of_scope`, preserve
`error.readyGateOutsidePaths` and `error.readyGateOutOfScopeDetail`, and guide retry finalization via
`jarvis run resume` — not source-file repair. Review every repair commit's file list before merging;
bounded repair can still touch in-scope paths when a mixed or in-scope gate failure triggered it.

Mutation verification inspects production diff paths only; test-file changes (basename contains `.test.`, e.g. `*.test.tsx`, `*.sandbox-unrunnable.test.ts`) are not mutation candidates and will not surface `surviving_mutation_failed`.

Mutation verification requires expectations independent of the mutated production behavior; self-referential doubles invalidate that evidence.

A `surviving_mutation_failed` outcome whose site is a timer callback in a determinism-guarded root (v2/src/daemon or v2/src/execution .test.ts) names both constraints: the natural kill test (which is forbidden by the determinism guard's real-timer prohibition) and the fix (extract the guard into a pure exported predicate and test both truth directions directly without a real-timer wait, then resume). Codify the extracted predicate directly in the guarded suite's test file and verify its coverage independently.

`surviving_mutation_failed` → `jarvis run resume` applies before implement recovery exhausts its bounded repair attempts. `mutation_repair_exhausted` is not admitted again: manually fix and publish the retained worktree, or untick criteria before a fresh implement run.

Inspect `jarvis run log <id>` for `runtime_smoke_outcome` after a successful completion. `observed-clean` records an executed smoke probe: the CLI help command succeeded, or the daemon lifecycle handshake (start → status → stop) succeeded with status reporting running state. `not-runnable` records every inspected production path and a non-empty discovery reason; it certifies discovery found no loadable CLI or daemon probe, not that runtime execution occurred. The handshake uses an isolated temporary daemon (not the operator's) and cleans up all IPC artifacts on all outcome paths.

A v2 implement run reporting `runStatus: "completed"` implies (1) the active subspec's
non-human-only acceptance criteria are all ticked at the boundary, (2) a completion commit
exists, (3) confirmed PR evidence (a pushed commit linked to an open PR), (4) the ready gate
is green, and (5) if the active subspec's acceptance criteria reference `bun run test:integration:v2`,
that command exits zero. Rows that exhausted the repair budget instead remain `failed` /
`ready_gate_failed` / resumable and do not imply a green gate until a gate-only resume succeeds. The spec.criteria-ticked contract prevents `done` / `no-work` completions when
unticked non-human-only criteria exist, re-reading the subspec from the run's worktree and
blocking before any completion commit or PR publication. The completion boundary enforces (2):
when the committer returns no new commit and the worktree is dirty, the run records
`completion_commit_failed` and names the uncommitted paths instead of masking them as `complete`.
The publication boundary enforces (3): when the publisher returns a `pushSha` but no PR evidence
(no `prNumber`), the run records `completion_commit_failed` (retryable) and skips ready finalization,
preventing silent publication gaps where code is pushed but no PR exists. A red gate demotes the
run to `failed` and blocks completion; resume the run after fixing the gate. If (5) applies and the
required integration test exits non-zero, finalization records `ready_gate_failed` with the integration
test command and output, blocks the draft-to-ready flip, and allows bounded repair iterations.
Until `implement-completion-requires-adversarial-mutation-verification` ships, mutation-review validation
remains a stopgap in addition to explicit required integration scope.

Implement PR bodies now carry an agent-authored review-altitude narrative in the PR marker block
(see [PR body narrative markers](./workflow-runner.md#pr-body-narrative-markers)). The shrink pass
authors this narrative after implementation; on re-publication, human edits inside the marker block
are preserved and clobber-protected by precedence rules.

v2 TUI tests can pass while ink rendering is broken when assertions only walk production
monitor state or the injected input hook without inspecting the ink element tree — see
[`test-writing.md` § TUI test strategy](./test-writing.md#tui-test-strategy). A test that drives
real ink painting into a fake stdout is green locally and red on CI ([#2417](https://github.com/cbrenner04/jarvis/issues/2417),
[#2418](https://github.com/cbrenner04/jarvis/issues/2418)); prefer region-local ink tree walks via
`createMonitorDisplay` and the injected input hook instead.

## Recovery

Documented gaps and operator workarounds. Remove entries when seeds merge.

### Stale `origin/<branch>` after hand-merge

Hand-pushed or hand-merged run branches often leave `refs/remotes/origin/<branch>` on disk
after GitHub deletes the remote head. Incomplete git-enabled `jarvis run workflow implement`
or `plan` re-runs (`resetStaleWorkspace` preflight) now prune that remote-tracking ref during
retirement and print `Pruned stale remote-tracking ref: origin/<branch>` on success stdout when
one was removed. `jarvis cleanup --abandon` uses the same retirement sequence.

### Intent finalization failed with staged files remaining

A reviewed intent workflow can fail after critic/actuator succeed but landing
(promotion, commit, push, or PR) fails, leaving `.jarvis-intent-stage/` still
populated. `jarvis run list` / `jarvis run wait <id>` show `landing_failed`
(`nextAction: "resume"`).

**Write row** (`runId` on the intent-split write step) settled `landing_failed`
means the reprompt budget was already spent — hand-edit `.jarvis-intent-stage/`,
then resume the **write step's** `runId` (the split row from `jarvis run list`,
not the review row):

```sh
jarvis run list              # find the failed write-step row (intent-split / split)
jarvis run resume <runId>    # write-step runId — re-enters the write loop
```

`reconstructWriteResume` preserves stage bytes and restores any pending
landing-contract reprompt context from the last `landing_contract_reprompt` log
event (including after pause).

**Review row** (`runId` on the review/finalization step) settled `landing_failed`
with populated stage replays finalization only
(`resolveIntentFinalizationResumeContext`), not the write loop.

Prerequisites: the failure must be git-enabled (git-disabled runs have nothing
to commit/push and aren't covered by this recovery path) and the stage must
still hold files — an empty/missing stage reports `unsupported_resume_context`
instead and needs manual inspection.

Recover a **review row** with:

```sh
jarvis run resume <runId>   # the review step's runId from `run list`/`run wait`
```

This replays only finalization — promoting `durableDir`, deleting the stage
and verdict sidecars, committing, pushing, and opening/reusing the draft
PR — from the persisted workflow snapshot. It never re-invokes split, critic,
or actuator. `jarvis run wait <runId>` reports `completed` on success.

### Workflow ends "complete" but produced no PR

A workflow can die after its step runs settle (review step, publication) — step
rows then all read `completed` while nothing was committed, pushed, or published.
Diagnose with:

- `~/.jarvis/daemon.log` — `Workflow execution failed (<workflow>): <message>`
- `jarvis run log <id>` — trailing `run_execution_failed` record with the message
- `jarvis run wait <entry-id>` — reports `harness_failure` instead of a clean complete
- `~/.jarvis/telemetry.jsonl` — per-role rows show which review roles actually ran; **filter by
  `run_id`, do not read the tail and assume** (see [Reading telemetry](#reading-telemetry))

Plan debate review has its own durable `run list` and TUI row, identified by the
authored workflow `stepId` alongside the plan draft row. During execution its
workflow detail shows the active adversary, advocate, adjudicator, or actuator;
after completion, failure, interruption, or daemon restart the retained row
shows its terminal status. Telemetry remains the per-role audit trail.

### Reading telemetry

`~/.jarvis/telemetry.jsonl` is the per-role audit trail: one JSON row per role invocation. Rows are
**snake_case** and carry full attribution plus cost:

```text
run_id  branch  project  step_id  attempt_id  invocation_id  workflow  spec_ref  worktree_path
role  agent  model  binding_id  binding_index  duration_ms  exit_kind  exit_reason
cost_usd  cost_source  usage  usage_source  ts  operator_session_id  record_kind  schema_version
```

Filter by `run_id`. Do **not** read the tail and attribute by recency — with two lanes running,
rows from different runs interleave:

```sh
python3 -c "
import json
rid='<run-id>'
for l in open('$HOME/.jarvis/telemetry.jsonl'):
    d=json.loads(l)
    if d.get('run_id')==rid:
        print(d['role'], d['agent'], d['model'], d['duration_ms'], d['exit_kind'], d.get('cost_usd'))
"
```

**Gotcha (2026-07-26): the keys are `run_id`, not `runId`.** Querying `runId` returns `None` on
every row, which reads exactly like "telemetry has no run attribution" and invites recency-guessing.
It cost one wrong conclusion this session. Print `sorted(d.keys())` on one row before concluding a
field is absent.

`cost_usd` is per-invocation agent cost, so agent-side spend is queryable per run and per spec —
metered agents record billed or list-price dollars; cursor rows from this change forward carry
list-price `cost_usd` when usage and a priced `priceKey` settle (`cost_source: "computed"`).
Pre-computed cursor rows lack comparable `cost_usd` (`no-price` or `no-usage`). That is the
source for the agent-cost column in a session report; the operator's own `/cost` is separate.

### Workflow reports a stale worktree claim

Distinguish five cases:

1. **Pre-mutation claim refusal** — incomplete implement/plan re-run refused
   before stale retirement with `worktree_claimed:` (not the `Cannot re-run
   incomplete spec:` wrapper). Worktree, branches, remote, and PR are untouched.
   Wait for the owning run to finish or release the key, then re-run.
2. **Pre-mutation claim-check failure** — daemon claim probe missing or RPC
   error; refused with `Cannot re-run incomplete spec:` (not `worktree_claimed:`).
   No retirement. Restore daemon IPC and retry.
3. **Post-retirement `start` failure** — retirement already ran, then `start`
   returned `worktree_claimed`. This is the bug class pre-mutation claim gating
   prevents; if you still see it on an older build, inspect partial teardown
   before re-invoking.
4. **Claim acquired after retirement but before `start`** — another dispatcher
   claimed the key in the gap; artifacts may already be gone. Finish any partial
   teardown by hand before re-running.
5. **Partial teardown already happened** — use the `Retirement destroyed
   artifacts:` summary and [`--abandon`](#v2-debris-blocks-the-jarvis1-fallback)
   remnants table; re-invoke is not always safe.

The pre-mutation client probe uses the same admission predicate as workflow
`start` (queued rows and registry claims, not `list` `isLive` alone). Stale
in-memory workflow claims that `start` would reclaim at admission match the
probe too — retirement may proceed when post-reclaim admission would succeed.
The probe still refuses before retirement when `start` would refuse without
reclaim (queued rows or a live registry-held claim), which prevents destruction.
A missing claim probe or claim-check RPC error refuses with the generic
incomplete-spec wrapper and performs no retirement (distinct from
`worktree_claimed:` and from live-held’s tolerant `list` behavior).

If a workflow start returns `worktree_claimed` after its prior owner is no longer
live and retirement did not run, invoke the workflow again. The daemon drops that
in-memory workflow claim at admission and preserves all worktree and branch state;
do not restart the daemon or remove a worktree for this case. A genuinely live
owner remains protected and continues to reject the same `(project, branch)`.

### v2 debris blocks the `jarvis1` fallback

A failed v2 run leaks its worktree under `~/.jarvis/worktrees/<project>/<branch>/`
and holds the branch name. `jarvis1 plan`/`run` for the same name then dies with
`fatal: '<branch>' is already used by worktree at …`, so **the v2 failure breaks the
v1 recovery path**. Clear it before falling back:

```sh
git worktree remove --force ~/.jarvis/worktrees/<project>/<branch>
git branch -D <branch>
git worktree prune
```

This is the **unmerged/failed** case; `jarvis cleanup` only retires *merged* workspaces, so it will
not clear this debris. Use `jarvis cleanup --abandon <name>` to retire one named wedged workspace:

```sh
jarvis cleanup --abandon <name>  # preview planned removal
jarvis cleanup --abandon <name> && answer 'y'  # confirm removal
jarvis cleanup --yes --abandon <name>  # agent/scripted removal
```

`--abandon <name>` resolves the workspace name to its branch, worktree path, and matching open PR. It previews the planned actions in order (remove worktree, delete local branch, delete remote branch, prune stale remote-tracking ref when present, close PR), prompts for confirmation, then executes them sequentially. Remote deletion is a no-op success when the branch was never pushed or the repo has no `origin`; a real remote failure (auth, network, protected ref) aborts. Successful retirement stdout names each step, including a pruned `origin/<branch>` remote-tracking ref when one was removed. If any step fails, the operation stops immediately and exits nonzero. It leaves source spec files and durable run rows intact. It refuses before touching anything if the worktree is missing or held by a live run (daemon `isLive` or locked by `.jarvis.lock`).

**Partial retirement.** An abort leaves everything from the failed step onward, and stderr names both the step and the remnants. `--abandon` cannot resume once the worktree is gone (name resolution only sees materialized worktrees), so finish by hand from the project root:

| Aborted at | What remains | Finish with |
| --- | --- | --- |
| worktree removal | worktree, local branch, remote branch, PR | fix the removal blocker, re-run `--abandon` |
| local branch deletion | local branch, remote branch, PR | `git worktree prune && git branch -D <branch>`, then the two rows below |
| remote branch deletion | remote branch, PR | `git push origin --delete <branch>`, then the row below |
| PR closure | open PR | `gh pr close <number>` |

**PR-ownership gates:** `--abandon` refuses and changes nothing if:

- **Multiple open PRs match the branch**: ambiguous ownership, no closure guarantee. Hand-close extra PRs or force-resolve branch ambiguity, then retry.
- **Single matching PR is ready (non-draft)**: operator-reviewed work — `--abandon` protects operator-reviewed branches from force-retirement. Merge the ready PR (preferred), or manually close it and retry.

A single open draft PR passes these gates and retirement proceeds. Zero matching PRs also pass.

Use `--dry-run` to preview without confirmation: `jarvis cleanup --abandon <name> --dry-run`. For agent-driven or scripted close-out, pass `--yes` (or `-y`) to apply the same plan without a TTY prompt; without it, non-interactive stdin assumes no and changes nothing.

### Blocked run: inspect and resume

A `blocked` run (agent appended `## Blocker` to the spec) keeps its worktree, branch, and
`git worktree list` registration. `jarvis run list` and `jarvis run wait <run-id>` report
`worktreePath` for blocked rows; inspect the spec and uncommitted work there and resolve the
blocker.

**`jarvis run resume` does not work on a blocked run** — it refuses with
`terminal_run` and names spec inspection / re-run recovery, and `run list` correctly reports the row as
`resumable: false` with remediation `inspect_spec`. To continue the work, resolve the blocker and **re-run the spec**. An incomplete
`jarvis run workflow implement` or `plan` re-run resets the stale worktree from `--base` (see
[Implement workflow](#implement-workflow)). A managed ordinary non-Git directory is instead left for
locked materialization to validate and replace; other status-listing failures still refuse. Uncommitted
work in a prior worktree is not carried forward.

When an agent emits a `blocked` token without appending a `## Blocker` section to the spec (or active
subspec on the implement path), the harness reprompts for blocker text. If the agent still fails to
provide it, the run reports as `missing_blocker` harness defect (`error.reason: "missing_blocker"`,
`error.retryable: true`, `error.nextAction: "resume"`), not bare `agent_blocked`. This applies to
both the write (run/plan) path and the implement workflow path.

**Blocker text persistence**: When a `blocked` outcome satisfies the blocker-text contract (agent appended non-empty `## Blocker`), the agent's blocker body is extracted and persisted as a durable `blocker_text_detail` log record. This allows you to retrieve the blocker reason from `jarvis run log <run-id>` without requiring access to the worktree spec file, which may not survive after the run completes. The persisted text is truncated to 500 characters for storage efficiency. Query the run log via `jarvis run log <run-id> | grep blocker_text_detail` to see the persisted blocker text inline, or parse the structured log for the `blocker_text_detail` event with its `blockerText` field.

### Orphaned non-terminal runs after daemon restart

Durable non-terminal rows from a prior daemon are reconciled to `killed` with reason
`daemon_restart` before IPC opens (#1430, race fixed by #1476–#1478). Once IPC is healthy, the
daemon automatically resumes every reconciled row with a resolvable workflow write snapshot.
The original run ID, snapshot, worktree, and branch are retained; check `jarvis run log <run-id>`
for its `run_recovery` outcome. A failed automatic admission becomes `failed` with an actionable
log diagnostic, without blocking other recoveries. Worktrees and branches survive.
Committed iteration SHAs on the same branch also survive kill, daemon reconcile,
and resume while the branch exists; only in-flight edits before that iteration's
git commit may be lost.

**In-flight iteration commits now cover every settled result (fixed 2026-07-27; previously corrected
2026-07-26).** A `publishCompletion: false` workflow write step (and every other git-backed write
loop) checkpoints before the SQLite boundary of *every* settled main-loop iteration — `progress`,
`complete` (`done`/`no-work`), `blocked`, `contract_miss`, `invalid_token`, `missing_blocker`,
`invocation_failure`, and `stall`/`idle_output_timeout` — not only `progress`. Previously
`write-loop.ts` committed only when the agent returned `result.kind === "progress"`; an agent that
finished its subspec on the first try returned `done` directly, so the committer was never called
and a mid-iteration kill lost everything. That gap is closed: a single-iteration `done` run now
emits an `iteration_commit` before `boundary_committed`, the same as a mid-loop `progress` step, so
a kill or crash after the checkpoint retains that iteration's edits. Ready-gate repair iterations are
the one exception — they keep their prior publish/recommit behavior, not this per-iteration
checkpoint. See `v2/docs/write-behavior.md` § Per-iteration commits for the full contract. Seed
`write-iteration-commits-never-engage` is resolved by this fix. **Implement re-run reset**
(`resetStaleWorkspace` before a new `jarvis run workflow implement`) still drops
the branch and unpushed commits; publication remains terminal-`complete` only.

**Controlled losses (kill, abort, watchdog) also checkpoint now (2026-07-27).** The gap above
covered only a settled agent turn racing the loop's own settlement logic; a `jarvis run kill`,
a plain `args.signal` abort, or an iteration watchdog (wall-segment or ceiling) firing
*mid-invocation* previously declared the iteration lost without waiting to see whether the
raced-away invocation had actually produced work. It now does: the loop waits for that
invocation to quiesce (settle or throw, once its own cancellation unwinds it), and if it settled
with a real step result, checkpoints that result before declaring the loss — before
`loop_finished` on abort/kill, before the `iteration_timeout` boundary on watchdog. A kill
acknowledgement (the RPC response) only records the kill; the checkpoint, and therefore full
durability, is only guaranteed once the write loop itself settles — `run kill` returning success
is not proof the checkpoint has landed, `run wait`/`run log` are. If a checkpoint after a kill
fails, the already-recorded `killed` status is authoritative and is not clobbered; the error is
logged for resume diagnostics instead. Ready-gate repair iterations are excluded from this floor
too — same carve-out as above. Waiting for quiescence is bounded (30s by default,
`quiescenceTimeoutMs`): an invocation that never quiesces at all (ignores its `AbortSignal`) still
lets the loop settle once that bound expires, falling through to the un-checkpointed loss instead
of hanging. Abrupt daemon/process death is outside this floor's guarantee — not a new limitation,
the same one every checkpoint here has always had.

**This trap observed live on 2026-07-14:**

- A reconciled orphan with a missing or unresolvable workflow write snapshot is not auto-resumed.
  It stays `killed`; `list` / `wait` report `unsupported_resume_context` with `retryable: false`
  and `nextAction: "stop"`. Fix the persisted context or re-run the spec rather than treating that
  row as a config-binding failure.

### Wedged run, no agent activity

Check `~/.jarvis/daemon.log` and `jarvis run log <run-id>`. Plan draft stalls
historically threw before agent invoke (fixed in shipped PRs); similar failures
may still exit without `iteration_started` follow-up until
`write-loop-iteration-timeout-on-stall` lands.

### Stopping a live workflow implement run

`jarvis run kill <run-id>` (or `k` in `jarvis tui`) aborts a live workflow-started write step
and records durable `killed`; `pause` / `resume` still refuse workflow rows
([`daemon-host.md` § Live controls](./daemon-host.md#live-controls-on-workflow-started-runs)).

**A daemon restart does not orphan in-flight work** (corrected 2026-07-25). This entry previously
said "stop the daemon only as a last resort — it orphans every in-flight run"; that predates the
reconcile-and-resume work (#1430, #1476–#1478). Startup reconciliation settles every non-terminal
row to `killed` / `daemon_restart` before IPC opens, then auto-resumes each one that has a
resolvable workflow write snapshot, retaining the run ID, snapshot, worktree, and branch — see
[Orphaned non-terminal runs after daemon restart](#orphaned-non-terminal-runs-after-daemon-restart).

The exception is narrow and worth knowing: a row with **no** resolvable write snapshot is not
auto-resumed and strands `unsupported_resume_context`. Review-step rows are exactly that shape, so a
restart while a review step is live will strand that row; a restart during a write step will not.
Observed 2026-07-25: four `unsupported_resume_context` rows in one session, all review steps, none
of them caused by a restart.

### Branch / worktree collision

```
fatal: '<branch>' is already used by worktree at ...
```

Remove the stale worktree under `~/.jarvis/worktrees/…` and delete the local
branch if safe. (`jarvis cleanup` handles this automatically once the branch's PR is merged; hand-remove only for unmerged branches.)

### Publication / completion failures

Retryable `completion_commit_failed`, `iteration_commit_failed`, `ready_gate_failed`, `landing_failed`, or `surviving_mutation_failed` on `list` / `wait`: inspect `error.publicationFailure` first for publication failures, or `error.survivingMutation` / source file and line for mutation failures; then verify the completion commit/PR state, fix `git`/`gh`/`origin` access, publication target state, or test coverage, then
`jarvis run resume <run-id>`. For `iteration_commit_failed`, the failing iteration never reached `boundary_committed`; resume retries that iteration (including its git commit) without advancing the loop. For a post-commit shrink `contract_miss` on `implement~shrink`, read `contract_miss_detail` on that row's log, then `jarvis run resume` on the `~shrink` row (not `inspect_spec` on the workflow entry). For an attached workflow whose entry reports a hidden shrink mutation failure, find and resume the owning `~shrink` row in `jarvis run list`, not the printed entry ID. When the owning row is instead a durable review-behavior step (e.g. `implement-review`, or a durable `review-debate` last step), resume that row's own id — the durable write step already committed, so resume replays only mutation re-verification, the ready gate, and publication, never a write-loop re-entry. Resuming the workflow entry id or a completed `~shrink` row for that scenario still refuses. Resume reuses the persisted write snapshot for step identity (rules, artifact path, outer agent order) before replaying publication without re-invoking the write-step agent; agent/model bindings come from the current machine profile at continuation time. Confirm the active rung from attempt telemetry until `jarvis run list` shows binding. Daemon-process logs are secondary, and do not delete the worktree.

**Store lock after a completed write step:** when `list` / `wait` report
`error.reason: "state_store_lock_timeout"` (`retryable: true`, `nextAction: "resume"`)
after the write loop already committed its `done` boundary, run
`jarvis run resume <run-id>`. The finished write step is not re-run; resume continues
from the persisted checkpoint. This differs from generic `harness_failure` on
message-less `run_execution_failed` records.

**`ready_flip_failed` is terminal** — do not resume. The flip error identifies the PR by number (`error.prNumber`); inspect and manually fix the PR draft → ready transition. The fix does not require a daemon restart or `jarvis run resume`. The PR number is also available via `jarvis run list <run-id>` as the `readyFlipPrNumber` field; use it to identify the PR to fix. After manual fix, verify `gh pr view <prNumber> --json isDraft` reports `false`, then proceed with the next workflow step or close the run.

### Intent-reviewed operator checkout

Review and landing must use the split external worktree, not the operator checkout.
If review dirties the primary checkout, treat as a harness bug; seed
`intent-reviewed-uses-external-worktree` (fold into `workflow-composable-collapse`).

### Daemon blocked on long git / ready subprocess

Responsive-daemon specs and seed `nonblocking-ready-gate-and-guard` address sync
subprocess on the daemon event loop. Symptom: `jarvis run list` hangs while a run
finalizes. Check for `bun run ready` or `git` children on the daemon PID.

### Cleanup: eligibility gate

`jarvis cleanup` runs four independent slices in one invocation: merged-worktree retirement,
worktree-independent merged-branch ref pruning, stranded open-home spec archival, and dead
daemon-socket reaping. Each slice previews in `--dry-run`, shares the apply confirmation prompt,
and continues after partial failure in another slice unless noted below.

**Local-only ref scope.** Bulk cleanup never deletes a branch on the remote repository. It may
delete exact local refs only: `refs/heads/<branch>` and, when present, exact
`refs/remotes/origin/<branch>`. `--abandon` is the path that deletes the remote branch.

#### Merged-worktree retirement

`jarvis cleanup` retires merged v2 worktrees discovered under `~/.jarvis/worktrees/<project>/`.
The eligibility gate decides whether a worktree is safe to remove.

After Git retires a workspace, cleanup resolves its durable workflow or ad-hoc spec
identity and archives an eligible completed artifact to `completed/` in the same cleanup
invocation; this path needs no rerun.
It prunes `ready-intents/<spec-name>.md` only when it byte-matches `intent.md`.
`--dry-run` lists the worktree, archive destination, and that proven prune without
changing worktrees, branches, specs, intents, or run rows. A failed retirement does
not inspect or move its artifact. If archival is refused (incomplete criteria, an
open matching PR, or another materialized owner), retirement remains successful and
stdout names the artifact and refusal; resolve that condition, then rerun cleanup.

Cleanup also scans immediate open directories in every registered `v2/spec/` home, even
when no workspace is retired. It ignores `completed/`, `seeds/`, and `ready-intents/`.
The same completeness, open-PR, ownership, intent-proof, and move/rollback checks apply;
stdout (including `--dry-run`) names candidates and refusals for unchecked criteria, open
matching PRs, and materialized owners. It never changes durable run rows.

When a completed open-home spec's owning worktree is retired in the same `jarvis cleanup`
apply invocation, stranded archival runs after retirement against a freshly discovered
materialized-worktree list (successful retirements only), so one pass archives the spec
into `completed/` without a second cleanup.

**`--dry-run` stranded prediction (bounded).** For open-home stranded archival,
`--dry-run` evaluates materialized-worktree ownership as if worktrees in the retire
preview set were already gone, so stranded archive lines match apply for that slice when
those owners are the only blockers and apply successfully retires those worktrees (the
same assumption behind apply's post-retirement materialized list). If a previewed
worktree is not removed, dry-run may still show stranded `archive:` while apply keeps
an owner and refuses. This is not full-command dry-run ≡ apply: worktree
retirement preview, dead sockets, post-confirm eligibility recheck, and merged-PR preview/apply
races are unchanged.

**`--dry-run` is a plan, not an outcome** for other cleanup slices. It lists an archive
destination based on the state it sees; the apply-time recheck runs again and can correctly
refuse every archival the preview listed outside the bounded stranded case above. Do not read
a dry-run listing as "these will be archived" — read it as "these are candidates". Confirm
against the apply run's stdout.

A worktree is eligible iff:

- **PR merged**: `gh pr view <branch> --json state,mergedAt` reports `state: "MERGED"` and
  `mergedAt` is set.
- **No non-terminal durable run**: the run store has no `(project, branch)` row whose status is
  outside `TERMINAL_RUN_STATUSES`. Before this shipped, reconciled `killed` rows blocked retirement
  until `jarvis cleanup --abandon`.
- **No live daemon run**: the daemon reports no live run for the `(project, branch)`.

Default bulk retirement does **not** read `~/.jarvis/worktree-locks/.../.jarvis.lock`. A live lock
does not block merged-worktree cleanup; `jarvis cleanup --abandon` still refuses when the lock is
held (see [§ `--abandon`](#v2-debris-blocks-the-jarvis1-fallback)).

Successful merged-worktree retirement removes the worktree, then prunes the same local head and
local `origin` tracking ref through the shared ref-prune path below.

#### Merged-branch ref pruning (worktree-independent)

Every cleanup also scans each distinct registered project Git root for local heads whose merged
PR authority is verifiable, even when no managed worktree exists for that branch.

**Prunes** (apply, after confirmation):

- Exact `refs/heads/<branch>` when the head matches exactly one merged PR's `headRefOid`, no open
  PR owns the branch, and apply-time guards pass.
- Exact `refs/remotes/origin/<branch>` when that tracking ref existed at preview time and still
  matches the previewed OID at apply time.

Successfully retired merged worktrees use this same path immediately after worktree removal.

**Keeps**:

- The repository base branch, the operator's current branch, and any branch checked out in a
  worktree (unless that worktree is retired in the same apply invocation).
- Local heads whose PR is not merged, is ambiguous, or cannot be verified (`gh` failure).
- Orphan `origin/<branch>` tracking refs with no matching local head.
- Branches with a non-terminal durable run or a live daemon run for the owning project.

**Preview and apply reporting** (project identity on every line):

- Dry-run: `prune ref: <project> <full-ref>` for each apply-time candidate (subject to the same
  revalidation guards as apply; not a guaranteed deletion).
- Apply success: `Pruned ref: <project> <full-ref>`.
- Apply skip (revalidation or ineligibility): `Skipped ref prune: <project> refs/heads/<branch> — <reason>`.
- Apply failure: stderr `Failed to prune ref <full-ref> (<project>): <message>`.

Apply revalidates head OID, tracking-ref OID, merged-PR authority, checkout status, and
durable/daemon run ownership immediately before each mutation; a ref that changed after preview
is skipped, not deleted. Dry-run lists candidates from discovery; apply-time guards (including
daemon reachability) can skip a previewed ref without deleting it.

**Partial failure.** A failed head or tracking-ref deletion is not reported as success, makes the
invocation exit nonzero, and does not block later eligible ref candidates or the independent
worktree-retirement, artifact-archival, and socket-reaping slices. Worktree retirement is
reported successful only when both removal and its required ref prune succeed.

Unusable registered project roots (missing, non-Git, or inaccessible) are reported on stderr as
`Skipped project <project>: <reason> (<root>)` and make the invocation exit nonzero.

**Fail closed**: if `gh` fails, or the daemon rejects or returns a malformed list probe, the
worktree is marked ineligible and skipped. Daemon-unreachable merged worktrees appear in bulk preview as
`Skipped merged worktree: <path>` with the stable reason
`Daemon unreachable; run jarvis daemon start`. Head-only merged-branch ref pruning uses the same
daemon-unreachable reason on apply skip (`Skipped ref prune: … — Daemon unreachable; run jarvis daemon start`)
and the same exit contract: at least one daemon-unreachable skip in either slice makes dry-run,
declined, and applied cleanup exit nonzero, including when nothing else is eligible, every head-only
candidate is skipped at apply, or a post-confirmation recheck withholds retirement. PR-not-merged,
non-terminal-run, live-run, and other ineligibility skips retain exit `0`. Cleanup does not impose a response timeout after a connection is established;
an established connection that never responds is outside this behavior. If the run store is inaccessible
(`listRuns()` throws), cleanup aborts with that error rather than skipping individual worktrees.

The CLI queries every live daemon socket discovered under `JARVIS_HOME` plus the invoking
digest's socket (same set as `jarvis run list`), issuing `list` on each and skipping sockets
whose connect, `list`, or parse fails without aborting the command. A socket counts as
answering only when connect + `list` + parse all succeed. Bulk cleanup unions `isLive` rows
for each `(project, branch)` across answering daemons. When no socket in that query set
answers, one stderr line recommends `jarvis daemon start`, then bulk cleanup still reaps dead
sockets and scans stranded open-home specs. Merged worktrees remain fail-closed with the
preview and exit behavior above. Timeout, permission, and unexpected connect failures on the
invoking socket do not abort when another socket in the query set would answer; when no
socket answers, non-`ENOENT`/`ECONNREFUSED` first errors still abort before those phases.
`jarvis cleanup --abandon <name>` still connects only to the keyed digest socket and refuses
before preview when that listener is absent. Worktrees ineligible for this session remain
untouched; retry after restoring daemon reachability.

Cleanup also enumerates and reaps dead daemon sockets under `~/.jarvis/daemon-*.sock`. A socket
is dead when its connect probe receives `ECONNREFUSED` or `ENOENT`, indicating no listener is bound;
dead sockets are removed. All other probe results (connection succeeds, timeout, permission error,
unexpected error) preserve the socket and are reported by reason. This allows `jarvis cleanup` to
safely run while overlapping keyed daemons are live: each socket is classified independently, and
only sockets whose daemons have exited are removed. If the jarvis home cannot be enumerated, no
sockets are removed in that cleanup run.

## Choosing an actuator

**Claude is usable as patch/implement primary again (2026-07-13).**
`claude-streams-output-to-watchdog` shipped: claude is now spawned with
`--output-format stream-json --verbose` (`v1/src/agents/claude.ts:68`), so the
idle-output watchdog observes it mid-iteration and can escalate down `agentOrder`.

Before that fix, **33 of 33** claude patch records carried `last_output_age_ms: null`
— the watchdog was structurally blind to claude, and a live claude run rode
`iterationTimeoutMs` to exit 8. That produced two misdiagnoses now known to be false:
"claude-haiku stalls to a zero-output iteration-timeout" and "claude-sonnet-5 is too
slow to be patch primary." **Neither was about the model.** Zero output was a missing
measurement, not a starved or slow agent.

**The v1 runbook's "shared Claude pool contention" guidance rests on that same
folklore and is contradicted** — two concurrent `claude-opus-4-8` *plan* runs
completed cleanly during the very claude *patch* run that "stalled", same pool, same
Claude operator session. `v1/src/modes/patch/pool-contention.ts` fires on process
existence and measures no contention. Ready-intent:
`retire-claude-pool-contention-folklore`. Cleanup: delete the v1 runbook's
[Shared model pool contention warning](../../v1/docs/operator-runbook.md#shared-model-pool-contention-warning)
section when it ships.

**v2's claude output now streams (shared adapter change, 2026-07-13).** `shared/invocation/`
now spawns claude with `--output-format stream-json --verbose`, making claude output
visible mid-invocation (not buffered until exit).

**v2's write path now arms an idle-output watchdog (2026-07-25).** `resolveWritePathIterationBounds`
resolves `idleOutputMs` from machine config `idleOutputTimeoutMs` (default 90 s; `0` disables)
and threads it onto every write-behavior step, alongside the existing wall segment
(`iterationTimeoutMs`) and hard ceiling (`iterationCeilingMs`). A silent invocation now settles
`idle_output_timeout` well before the wall would fire; see
[`write-behavior.md`](./write-behavior.md) for ordering and
[`daemon-host.md`](./daemon-host.md) for the operator-facing outcome. Resumed write steps
rehydrate the persisted `idleOutputMs` bound from the workflow snapshot, so a paused/resumed
run stays armed.

**`idleOutputTimeoutMs` applies to workflow write and review roles (2026-07-26).**
Configured positive values are passed to every workflow review role, while `0` disables
the review-role watchdog. An absent key leaves the step unstamped and uses the 90 s
review fallback. Pre-fix `role_stalled` records, including the `home.json` 240 s
observation, used the hardcoded 90 s review budget even when configuration requested
otherwise; interpret those historical records under the old behavior.

**Cursor is spawned with stream-json (shared adapter change, 2026-07-24).** Review-role
invocations (`v2/src/execution/review-role-invocation.ts`) have carried their own idle-output
budget since before the write path did. Under `--output-format text` cursor emitted nothing
until its final response, so a silently-editing review role produced zero stdout and settled
`stall` at exactly the idle budget — observed 2026-07-24 at `dur=90003`, twice, with edits
already on disk. This was the shared/v2 invocation path, not v1; `v1/src/agents/cursor.ts` is
unchanged and still uses `text` mode.

What changed: `shared/invocation/agents.ts` now spawns cursor with `--output-format
stream-json --stream-partial-output`, and `shared/invocation/cursor-json.ts` renders the
terminal `result` event (or concatenated text frames) back into result text. Any stdout
chunk re-arms the idle timer, so a cursor run that emits frames mid-invocation no longer
trips the watchdog.

**Confirmed by observation (2026-07-26).** This entry previously carried an "unverified premise —
do not treat this as a confirmed fix" caveat, on the grounds that no real cursor stream-json
transcript had been captured and it was not established that cursor emits frames during a silent
edit phase. **It does.** A cursor `implement` role on a v2 workflow ran **948s** before settling
`stall` — the idle timer was re-armed by cursor's frames for roughly 14 minutes before the fatal
pause. A run that emitted nothing would have died at the idle budget, not fifteen minutes in.

The residual lesson is about the *budget*, not the adapter: `DEFAULT_IDLE_OUTPUT_TIMEOUT_MS` is
90_000 (v1 patch-loop parity) and is too tight for v2 implement work, where an ordinary pause
between frames exceeds it. `config/machines/home.json` now sets `idleOutputTimeoutMs: 240000`.
Bounds resolve CLI-side per invocation (`v2/src/commands/workflow.ts:136`), so changing them needs
no daemon bounce. Treat a `role_stalled` / `idle_output_timeout` on a long-running role as a budget
question first and an agent question second.

### v2 takes its agent order from a different config key than v1

**v1** reads `modes.<mode>.agentOrder` (ordered `{agent, model}` objects, per mode). **v2** reads
the flat top-level **`agents`** array of bare names (`v2/src/cli.ts:236` → `loadMachineConfig`). It
never reads `modes.*.agentOrder`.

So reordering `modes.*.agentOrder` — the lever `agents.md` and the v1 runbook document — changes v1
and **nothing about v2**, silently. Observed 2026-07-14: codex was moved to the front of every
`modes.*.agentOrder` and every subsequent v2 run still invoked claude. To change v2's order today
you must also edit the top-level `agents` array. Seed:
`v1-and-v2-read-agent-order-from-different-config-keys`. Cleanup: delete when it ships.

Per-run overrides, rather than churning config — **v1 only**; v2 has no `--agent` flag:

```sh
jarvis1 run --agent cursor:"Composer 2.5" <spec>   # free; verify `cursor-agent status` first
jarvis1 run --agent codex <spec>                   # paid, fast
```

## Concurrency

Same throttle guidance as v1: ~1–2 concurrent `jarvis1 run` implement sessions;
workflow implement runs full gates — avoid stacking many concurrent implement
workflows on one machine.

Do not merge to `main` blindly during long in-flight runs; see v1 runbook
[Integration-merge-then-retest](../../v1/docs/operator-runbook.md#integration-merge-then-retest-pattern).

**State store concurrency:** The durable run state store (`~/.jarvis/state/v2.sqlite`) opens with WAL journal mode and a 5-second busy timeout, enabling safe concurrent reader-vs-writer access on a single machine without additional coordination. Overlapping workflows and routine polling (daemon `list`, TUI status checks) against the store are safe and do not cause `database is locked` errors.

## Coding agents in sandbox

- **Do not** start/stop/restart `jarvis1 log-server` — v1 concern; see v1 runbook.
- Sandbox may block `127.0.0.1` — daemon/socket probes can false-negative; see v1
  runbook § Sandbox blindness.
- **Do not** start a second `jarvis daemon` to “fix” a stuck run.

## Known gotchas

Operators add bullets here; delete when fixed.

- **`daemon status` reports on the *current* source digest, so a merge makes it read `stopped`
  (2026-07-30):** the `jarvis` launcher keys its daemon by a digest of the source tree, so every
  merge to `main` — including your own session's merges — rotates the key. `jarvis daemon status`
  probes only the current digest and prints `stopped`, while the daemon that owns your in-flight
  runs is alive and working on the previous key. This reads exactly like "the daemon died and my
  runs are orphaned," and it is not. Observed this session after merging four PRs during three live
  lanes; two of the three lanes completed normally under the superseded daemon.

  Confirm before concluding anything:

  ```sh
  ls -lt ~/.jarvis/daemon-*.sock          # one socket per live keyed daemon
  ps ax -o comm= | grep -cE 'cursor-agent|codex-aar|claude'   # agents actually writing
  jarvis run list | awk -F'\t' '$5=="live"'                   # merges across keyed daemons
  ```

  `jarvis run list` already merges across live keyed daemons, so it stays truthful when
  `daemon status` does not. Starting a daemon on the new digest is safe and supersedes the old one
  (see [Overlapping daemons after rebuild](#observe)); it is not needed to rescue the old runs.

  The real cost is confusion, so prefer batching merges at points when no lane is live — the
  existing [Concurrency](#concurrency) guidance ("do not merge to `main` blindly during long
  in-flight runs") is about this.

- **A `completed` implement row can ship a mutation-verification artifact (2026-07-30):** PR #2314
  (`plan-split-preserves-draft-scope`) committed, pushed, flipped to ready, and reported
  `completed` while its commit carried `if (start !== -1) return null;` — the inverted form of
  `start === -1` in `shared/module-boundary-surfaces.ts`. The worktree *working copy* held the
  correct source while `HEAD` held the mutation, so the run's own gate and a hand
  `bun test <file>` both passed; CI failed 26 v1 plan tests. **Read the committed diff, not the
  worktree**, when a CI failure cannot be reproduced locally:
  `git -C <worktree> show HEAD:<path>`. Recovery was `gh pr close` + `jarvis cleanup --abandon` +
  a fresh implement run. Seed: `v2/spec/seeds/mutation-verification-artifact-reached-the-completion-commit.md`.
  Cleanup: delete this bullet when it ships.

- **`--abandon` refuses over a ready PR and over a dead keyed socket (2026-07-30):** retiring a
  wedged workspace after the executable was rebuilt hits two guards in sequence —
  `Cannot abandon: no daemon is listening` (the digest-keyed socket moved; fix with
  `jarvis daemon start`) and then `Cannot abandon: matching PR is ready (non-draft)` (fix with
  `gh pr close <n>`, or mark it draft again). Both are the guards working; the order is not obvious
  from the messages.

- **Migration ids collide across parallel branches (2026-07-30):** two concurrently-implemented
  specs each added `015-…` to `MIGRATIONS` in `state-store.ts`, and
  `state-store.test.ts` asserts a hardcoded `migrationCount.total`. The second branch to merge
  conflicts and then fails that assertion. Resolution: renumber the later migration and bump the
  count. Worth checking before dispatching two specs that both touch persistence.

- **A wrapped `(Manual)` criterion is not read as human-only (2026-07-30):** the marker is matched
  on the criterion's first line only, so a line-wrapped criterion ending in `(Manual)` blocks
  `spec.criteria-ticked` and settles `contract_miss`. Two dispatches burned on
  `workflow-collapse-drops-test-flag`. Workaround: move the marker to the first line of the bullet
  (#2321). Seed: `v2/spec/seeds/human-only-marker-read-from-first-line-only.md`. Cleanup: delete
  when it ships.

- **`idle_output_timeout` clusters with machine load (2026-07-30):** at 5–8 concurrent implement
  lanes (load average 15–25 on this machine) three runs settled `idle_output_timeout`
  (`retryable: false`, `nextAction: "stop"`) — `cleanup-prunes-merged-dead-branches`,
  `plan-split-preserves-draft-scope`, `ready-gate-red-in-untouched-files`. All three recovered on
  re-dispatch at lower load. Read a cluster of `idle_output_timeout` as a saturation signal, not an
  agent verdict; `idleOutputTimeoutMs` in `config/machines/home.json` is the lever if you want to
  keep the fan-out.

- **A dependent plan run costs one dispatch to learn its prerequisite is unmerged (2026-07-30):**
  five plan runs settled `blocked` / `agent_blocked` with accurate `## Blocker` text naming an
  unmerged sibling spec (slice-4 daemon observation, slice-5 terminal action,
  `list-row-step-honesty` ×1, `markdown-only-workflow-ready-repair-rejects-code-edits`,
  `ready-gate-repair-omits-jarvis-sidecars-from-commits`). The refusals are correct and cheap, but
  fanning out a whole dependency chain at once wastes a run per unmet edge. Read the blocker from
  the staged intent, not the run row: `sed -n '/## Blocker/,$p'
  ~/.jarvis/worktrees/<project>/plan/<name>/.jarvis-plan-stage/intent.md`.

- **A spec that widens an interface needs its test doubles named in scope (2026-07-30):**
  `pipeline-store-enumeration` blocked immediately — adding a required `StateStore` member broke
  `crashOnceMidBoundary` in `v2/src/execution/write-loop.test.ts`, a file the spec did not name, and
  patch-mode scope forbade touching it. The agent refused correctly. Fix was a one-line spec edit
  naming the doubles (#2301), then re-dispatch. When planning an interface widening, name the
  complete-implementation doubles in the task checklist.

- **Match the `live` field, never grep the substring (2026-07-26):** `jarvis run list` rows are
  tab-separated and column 5 is `live` or `not-live`. `grep -q "live"` matches **`not-live`**, so a
  wait loop built on it never exits. Worse, branch names can contain the word: watching
  `every-live-workflow-is-killable` matched on the branch name alone. Four background watchers span
  for hours reporting nothing. Use the field:

  ```sh
  jarvis run list | awk -F'\t' '$5=="live"'          # genuinely live rows
  until [ -z "$(jarvis run list | awk -F'\t' '$5=="live"')" ]; do sleep 45; done   # wait for idle
  ```

- **Watch a workflow by branch, not by run id (2026-07-26):** any id you are handed goes stale.
  `jarvis run workflow` returns its *entry* run id, which settles while the workflow continues under
  new ids, and `jarvis run wait <id>` returns on that row, not the workflow. A run id quoted in
  conversation is usually already terminal by the time it is read. The branch is stable for the life
  of the work:

  ```sh
  jarvis run list --branch <spec-dir-basename>
  ```

  In `jarvis tui` the left pane nests pipelines into stages and workflow runs; press
  **`e`** on a selected pipeline or stage to expand constituent runs. Unattributed
  workflows stay one collapsed row per invocation with no flat-row **`e`** expansion.
  A terminal constituent id you are hunting for inside a collapsed stage row requires
  expanding that stage first.

- **Never `git checkout -- <file>` to undo a mutation test (2026-07-26):** it reverts *all*
  uncommitted work in that file, not just the mutation. Done twice in one session, silently
  discarding an in-progress fix each time. Copy the file first and restore from the copy:

  ```sh
  cp path/to/file.ts "$TMPDIR/file.bak"
  # mutate, run the test, confirm it fails
  cp "$TMPDIR/file.bak" path/to/file.ts
  git status --short   # confirm your own edits survived
  ```

- **An empty result from your own query is not evidence (2026-07-26):** three wrong conclusions this
  session came from a malformed query rather than the system — `grep "live"` matching `not-live`,
  `runId` returning `None` because the key is `run_id`, and a sandboxed `git`/`gh` call failing on
  TLS and reading as "no open PRs". Before concluding a thing is absent, prove the query works:
  print the available keys, check the exit code, or run it against a case you know is non-empty.

- **Cursor can report a false `quota` at ~24s (2026-07-26, not seeded — cost only):** three cursor
  invocations across three days settled `exit_kind: "quota"` at 24584 / 24246 / 24430 ms, and in the
  last case cursor ran the *next* role successfully 46 s later and a 497 s role after that. Real
  quota exhaustion fails fast and stays failed; this tight a duration cluster is a timeout or
  stream-disconnect matching the quota stderr heuristic (`v1/docs/quota-signals.md`). Consequence is
  spend, not correctness: the spurious signal escalates to the next rung, one instance costing
  $1.48 of `claude-opus-5` for work cursor would have done on subscription. It also quietly
  undermines a cursor-first order. Check telemetry before believing a quota escalation.

- **`missing_blocker` can fire when the agent did append a blocker (2026-07-26):** run `4bfca748`
  settled `paused` / `invocation_failure` / `missing_blocker` while `## Blocker` sat at line 93 of
  the active subspec, with accurate content. That run had **0 commits and 4 dirty files**, so the
  blocker text existed only in the uncommitted worktree — the leading suspicion for why detection
  missed it. Read the subspec in the worktree before treating `missing_blocker` as agent
  misbehavior.

- **Trust `list` / `wait` `resumable`, not a stale `loop_finished` flag (2026-07-25):** admission
  projects from the composed operator error (`nextAction: "resume"`). A historical log row may still
  say `resumable: true` while the row is not admitted — use the row's `resumable` field and the
  `terminal_run` recovery text instead of abandoning the run because the log looked resumable.

- **Nothing you normally check tells you a workflow is finished (2026-07-21):** three separate
  signals all read "done" while agents were still writing the worktree — attached `jarvis run workflow`
  exit after workflow entry-terminal rollup (not merely the first step), `jarvis run list` showing every row
  `completed` / `not-live`, and an idle run table. Post-completion mutation verification keeps
  running in the worktree after all of them, and while it runs the tree legitimately contains
  deliberately broken source (the verifier flips a guard, e.g. `===` → `!==`, then runs scoped
  tests). Reading the tree in that window shows uncommitted garbage that looks exactly like a
  harness defect. This cost three misdiagnoses in one session, one of which became a seed before
  being retracted. **Before concluding anything about a v2 run, require all three: no process at all
  under `lsof +D <worktree>`, a clean `git status`, and `local == remote`.** Seeds:
  `workflow-commands-block-the-operator-terminal`, ready-intent
  `workflow-command-reports-terminal-workflow-failure`.
  **Match on any process, not on `bun` (corrected 2026-07-21).** This bullet previously said "no
  `bun` process". `bun` only appears during the test/gate/mutation phase; the *agent* write phase
  runs the agent binary — `codex-aar`, `claude`, or `cursor-agent`. Grepping `lsof` output for `bun`
  reports an actively-writing worktree as idle, which is the same wrong conclusion this entry exists
  to prevent. Observed 2026-07-21: seven worktrees all read "0 bun" while every one of them had a
  live `codex-aar` writing in it. Use the process list itself:

  ```sh
  lsof +D ~/.jarvis/worktrees/<project>/<branch> | tail -n +2 | awk '{print $1}' | sort -u
  ```

  **Do not poll this on a loop.** `lsof +D` walks the worktree recursively and is expensive: on
  2026-07-21, running it across every worktree every 30 seconds put two `lsof` processes at the top
  of the CPU table (25% and 14%), above every agent it was measuring. Use it as a one-shot check
  before drawing a conclusion about a specific run. To *wait* for the fleet to settle, count agent
  processes instead — O(process table) rather than O(files in tree), same answer:

  ```sh
  ps ax -o comm= | grep -cE 'codex|cursor-agent|claude'
  ```

  **Count from `comm=`, not `args=`.** `ps ax -o args= | grep -c '[d]aemon-entrypoint'` returned 5
  on a machine running 2 daemons — full command lines match on wrapper and child processes that are
  not themselves daemons. When a count matters (how many daemons are up, whether the fleet is idle),
  count distinct PIDs of the process you actually mean, and cross-check against
  `jarvis daemon status`.
- **Surviving mutation failures are failed and resumable (2026-07-21, sibling lookup fixed 2026-07-27):**
  a run ending `loopOutcomeKind: "surviving_mutation_failed"` settles `failed` on `run list` / `run wait`
  with `error.reason: "surviving_mutation_failed"`, `retryable: true`, `nextAction: "resume"`, and the
  surviving mutation text plus source file and line. `run resume` accepts that row. During the
  post-completion verification tail the durable row is `in-progress`, not `completed`. Ready-intent:
  `surviving-mutation-failure-is-resumable-failed`.

  **Eligible owning rows:** a failed durable `review-debate` row (including an implement workflow's
  debate `implement-review`) or a failed durable landing-bearing `review` row. A non-durable light
  `implement-review` sharing that step ID is never a recovery target. The workflow entry ID and a
  completed hidden `~shrink` row always refuse — only the review-behavior row itself is eligible.

  **Sibling resolution (fixed 2026-07-27):** the durable write step's completed row is resolved by
  workflow `invocationId`, matching either the authored write stepId or a completed `<stepId>~link-N`
  row — the shape a linked-implement workflow's terminal pass persists. Previously the lookup only
  matched the bare authored stepId, so a linked-implement write step's review row lost its sibling and
  was wrongly projected non-resumable. `run resume`, direct-row `run list`, and direct-row `run wait`
  all route through the same admission resolver, so a stale pre-fix `loop_finished` record still
  claiming `resumable: true` is projected `resumable: false` / `unsupported_resume_context` if current
  reconstruction can't resolve the sibling — immutable log history is never rewritten, only re-read
  through the current resolver. Conflicting fields recorded on the review row itself (worktree, base
  ref, spec path, completion agent) never override the selected write row's own values.

  **Admitted outcomes:** `surviving_mutation_failed`, plus the `completion_commit_failed` /
  `ready_gate_failed` this same resume tail can itself settle. `runtime_smoke_failed` is excluded
  (retrying this tail cannot change a runtime-smoke result), along with `landing_failed`,
  `ready_flip_failed`, generic invocation failures, and completed rows.

  **Prior state (fixed by the above):** run `0c81e851` measured the row settling
  `surviving_mutation_failed` with `resumable: true` in its `loop_finished` record while `run list`
  projected `unsupported_resume_context` and `run resume` refused on step *kind* — three surfaces,
  three answers. Seed: `resume-refuses-the-review-row-it-advertises`.

  **Ticked mutation failures recover through implement.** If the agent ticked every acceptance
  criterion before the mutation failure, rerun `jarvis run workflow implement` with the same branch
  and spec. It finds the retained lineage and runs only mutation re-verification, gate repair, and
  publication; it does not untick criteria or replay the write step. **Commit first:** mutation verification and
  body-summary derivation are diff-derived against the base ref; fix coverage in the worktree and let
  `run resume` commit it (or `git commit` it yourself first) — an uncommitted fix either gets committed
  by the resume tail or settles a named `completion_commit_failed` failure, it is never silently
  re-verified against the stale diff. A resumed row that itself settles `ready_gate_failed` or
  `completion_commit_failed` (not just a repeat `surviving_mutation_failed`) is admitted by a further
  `run resume` on the same row; a `runtime_smoke_failed` settlement from this tail is not.
  When the criteria are already ticked, `jarvis run workflow implement --base <ref> --spec <path>`
  finds the newest matching failed mutation-finalization row itself and retries that tail without
  unticking or replaying the agent write step. `implement.recovery_target_missing` means its retained
  worktree or branch was cleaned up; `worktree_claimed` means another live run owns it. Both refuse
  without changing the workspace.
- **Daemon and execution tests must use bounded condition polling, not sleep-as-wait (shipped 2026-07-19):** Agent-runnable daemon and execution tests (`v2/src/daemon/**/*.test.ts` and `v2/src/execution/**/*.test.ts` excluding `.sandbox-unrunnable.test.ts`) are statically guarded by `scripts/guard-deterministic-daemon-tests.ts` (runs as part of `bun run check`). Forbidden: direct timer-backed waits like `await new Promise((resolve) => setTimeout(resolve, 100))` or `Bun.sleep(ms)`. Allowed: bounded condition polling with either a deadline (`Date.now() < deadline`) or signal bound (`!signal?.aborted`). Tests requiring irreducible real-clock timing must be in `.sandbox-unrunnable.test.ts` files. See [`v2/docs/test-writing.md` § Deterministic daemon and execution tests](./test-writing.md#deterministic-daemon-and-execution-tests).
- **Test doubles must not call production behavior (shipped 2026-07-22):** Fixtures under `v2/src/testing/**` are statically guarded by `scripts/guard-test-double-production-calls.ts` (runs as part of `bun run check`). Test doubles that compute responses by calling production behavior violate the guard and must be refactored to use direct value returns or allowlisted entry points (state-store, daemon-lifecycle, CLI main). Type-only imports, unused constants, and calls to allowlisted builders are permitted. See [`v2/docs/test-writing.md` § Test doubles must not call production behavior](./test-writing.md#test-doubles-must-not-call-production-behavior).
- **Reviewed plan lands its spec again (verified 2026-07-21):** the 2026-07-16 stranding
  (`plan --review-passes 1` producing a PR with `.jarvis-plan-stage/` and no spec) is **fixed** —
  the reviewed-plan verdict landing work (#1869) repaired it. Verified end to end with
  `--review-passes 1 --review-behavior debate`: the PR carried `index.md`, the subspec, `intent.md`,
  and `verdict-plan.md`, with no stage directory. Scope of the check: debate behavior only; `light`
  was not re-tested.
- **The three mechanical gates do not replace review (corrected 2026-07-21):** v2 implement
  completion runs diff-derived mutation verification, runtime smoke verification, and the green
  ready gate. This entry previously concluded "no additional manual review needed." **That is
  wrong.** On 2026-07-21, three of five implement PRs passed all three gates — plus green CI, fully
  ticked criteria, and in one case an automatic draft→ready flip — while carrying defects that only
  independent diff review caught: a review checkpoint reused across dispatches (silently skipping
  patch review on re-runs), a durable-step exclusion rendering live review rows as
  `invocation_failure`, and a finalization path leaving `ready_flip_failed` / `runtime_smoke_failed`
  rows stuck `in-progress` (stranding them non-live and hanging `run wait`). Mutation verification
  proves changed guards are *covered*; it cannot judge whether a transition is *correct*. Run the
  review step, and read the diff.
- **`daemon stop` and `run kill` can deadlock each other (2026-07-16):** a durable row that is
  non-terminal *and* not in memory is refused by both (`active durable runs` / `run_not_active`), so
  nothing can clear it. `run list` shows the tell: `in-progress` + `not-live` on a spec
  whose PR already merged. **Recovery (verified 2026-07-16): `kill -9 <daemon-pid>` then
  `jarvis daemon start`.** Startup reconciliation settles every orphaned non-terminal row to
  `killed` / `daemon_restart` before IPC opens, which is what the refusing `stop` was blocking you
  from reaching. Do **not** hand-edit `~/.jarvis/state/v2.sqlite`. Confirm no run is genuinely live
  first — this orphans anything that is. Seed: `a-daemon-lost-run-row-deadlocks-the-daemon`.
  Cleanup: delete when it ships.

  **Most `DaemonStopRefusedError: active durable runs` is not this bug (2026-07-26).** The deadlock
  needs rows that are non-terminal **and** not-live. A refusal naming rows that `run list` reports
  `in-progress` + **`live`** is the guard working correctly — real work is in flight. Check the
  named IDs in `run list` before reaching for `kill -9`; prefer `jarvis run kill <run-id>` on live
  rows (including workflow-started write steps). With in-flight iteration commits not engaging
  (see § Orphaned non-terminal runs), killing the daemon over a genuinely live run discards that
  run's entire worktree of uncommitted work. On 2026-07-26 a stop refusal named two IDs, both
  genuinely live, holding 14 modified files between them and one commit.
- **`JARVIS_READY_TIER` is stomped, not inherited (2026-07-16):** `ready-finalize.ts:54` spreads
  `process.env` and then overwrites the key with `"full"`, so setting it locally does nothing. The
  full aggregate gate is ~85% of a v2 workflow's wall clock (~13 of ~15 min on a two-file markdown
  plan spec). Seed: `ready-gate-tier-is-not-configurable`. Cleanup: delete when it ships.
- **`jarvis cleanup` archives completed v2 specs (shipped 2026-07-17):** run it at session end
  (`jarvis cleanup --dry-run` to preview, then `jarvis cleanup`, `[y/N]`; use `--yes` for scripted apply) to retire merged worktrees,
  prune eligible merged local heads and local `origin` tracking refs, and archive eligible open-home specs under `v2/spec/completed/`.
  Unmerged/leaked worktrees use `jarvis cleanup --abandon <name>` (see [Recovery § Branch / worktree collision](#branch--worktree-collision)).
  `jarvis1 cleanup` remains blind to the v2 home; use `jarvis cleanup`.

- **Permanent 180-second per-file timeout floor (2026-07-19):** `SUPPORTED_HEALTHY_FILE_BUDGET_MS = 180_000` in `scripts/run-v2-tests.ts` is a permanent invariant that both aggregate (`run-tests.ts`) and scoped (`run-v2-tests.ts`) runners must meet. The cutoff cannot be undercut below this floor without rejecting the change at preflight; regression tests in `scripts/run-v2-tests.test.ts` enforce this guard, and `test/test-slices.test.ts` asserts policy parity across runners. The 180-second budget accommodates the slowest healthy file (`v1/test/run.test.ts` at ~120s) and prevents timeout drift that previously silently reddened the local ready gate while CI stayed green.
- **Scoped CI vs. aggregate ready contract (2026-07-18):** `bun run ready` runs the aggregate
  suite, which CI never runs (CI scopes by changed path via `scripts/ci-test-scope.ts`). Roster
  equivalence (aggregate = union of six scoped slices) and policy parity (per-file timeout floor, isolation,
  failure handling) are protected by regression tests (`test/test-slices.test.ts`,
  `scripts/ci-test-scope.test.ts`), ensuring green CI is evidence the local gate can pass. When
  a gate goes red on a diff that cannot explain it, check path classification is correct; if so,
  the failure is environment-specific (machine load, system flake) not a code issue. See
  [v2 behaviors § Test execution](./v1-behaviors.md#test-execution-and-development-workflows) and
  [v1 runbook § The gate](../../v1/docs/operator-runbook.md#the-gate).
- **Launch `jarvis run workflow` from the project root (2026-07-14):** `--spec` resolves against
  your shell's cwd, and the resulting repo-relative path is re-resolved *inside the run's own
  worktree*. A cwd inside another git worktree (e.g. `.worktree/<x>/`) yields a path that passes
  preflight — it really exists from the project root — and then fails `harness_failure` at the
  routing read, **after a full agent write step**. Cost one run 7m52s and its tokens. Seed:
  `spec-path-is-not-validated-in-the-run-worktree`. Cleanup: delete when it ships.
- **Every implement run has committed a red gate (2026-07-14):** four for four this session, all
  trivially auto-fixable (import ordering, a formatter violation, one fabricated test assertion).
  The full-tier gate catches them, but a red gate is terminal: the run publishes a draft PR over
  the broken commit and stops. v2 now runs autofix before bounded repair on red gates; formatter-only
  failures should clear without agent turns. Genuine non-autofixable failures still enter repair.
  Seed: `red-gate-does-not-feed-back-to-the-agent`. Cleanup: delete when it ships.

- **A terminal run id does not mean the workflow is done (2026-07-14):** `jarvis run wait <id>`
  returns when *that run* goes terminal, but the workflow continues under a **new run id** (the
  shrink step, then publication). Twice in one session this made a working run look like it had
  dropped its work, and cost an unnecessary hand-recovery. Before concluding a run committed
  nothing, check `jarvis run list` for a **live row on the same branch**. Seed:
  `workflow-completes-before-its-review-step` (#1488). Cleanup: delete when it ships.
- **`in-progress` + `not-live` is normal while a run finalizes — it does not mean stuck
  (2026-07-16):** `isLive` tracks the *agent process*, so once the write loop finishes the row reads
  `not-live` for the whole publication-and-gate tail. That tail is **~8-15 minutes** (the gate runs
  the full aggregate suite), and `jarvis run workflow` blocks the entire time with no output. The
  durable row flips to `completed` on its own at the end. Observed twice this session, and both times
  it read as the documented strand defect: the operator drafted a seed for a phantom bug and
  `pkill`ed one healthy plan run at ~15 minutes. **Before concluding a run is stranded, check
  `jarvis run log <id>` for a `loop_finished` and wait out the gate** — a genuinely stranded run
  never settles at all, and `daemon.log` names its failure. See also the `run wait` caveat below: a
  terminal run id does not mean the workflow is done.
- **`run log` snapshots by default; `--follow` still blocks (corrected 2026-07-27):** this entry
  previously read "the daemon goes deaf while a run is active," blaming sync git in the publication
  path and reporting that `jarvis run list` hung too. Measured during one live implement run:
  `run list --limit 3` returned in **0.246s**, `run log <terminal-run>` in **0.295s**, while
  `run log <live-run>` hung past 120s printing nothing — and returned the instant the run went
  terminal. The daemon was responsive; the CLI just followed unconditionally. `run log <id>` now
  replays persisted records and exits once the daemon closes the stream, live run or not. Pass
  `--follow` to keep tailing new records as they append — it now exits on its own once the followed
  run settles, in addition to closing on client disconnect.
- **A `completed` P0 may not be fixed (2026-07-12):** two P0 seeds were archived as
  complete while the bug they named still reproduced on first launch — the fix
  landed one layer away (CLI preflight, not the runner; prompt text, not the
  contract). Re-run the preset before believing the status.
- **List polls heavy (2026-07-12):** TUI refresh drives `list`; terminal retention
  caps at 50 newest terminal rows. See `daemon-terminal-run-retention` spec.
- **Preset cartesian product (2026-07-12):** avoid new `*-reviewed` preset code
  paths; seed `workflow-composable-collapse`. Cleanup: delete when collapsed.

## Related docs

| Doc | Topic |
| --- | --- |
| [`install-and-config.md`](./install-and-config.md) | Bootstrap, config errors |
| [`first-workflow-walkthrough.md`](./first-workflow-walkthrough.md) | Happy path |
| [`workflow-runner.md`](./workflow-runner.md) | Presets, review, routing |
| [`write-behavior.md`](./write-behavior.md) | CLI surface, write loop |
| [`daemon-host.md`](./daemon-host.md) | IPC, errors, retention |
| [`coding-standards.md`](./coding-standards.md) | Restraint principles |
| [`v1/docs/operator-runbook.md`](../../v1/docs/operator-runbook.md) | Plan/run/cleanup/triage/cost |
