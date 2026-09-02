# v2 operator runbook

Reference for the **operator** driving the primary v2 harness (`jarvis`) on the Jarvis repo. **Operator** is the single name for this role.

Scope: **Jarvis-on-Jarvis v2 workflows** — daemon-backed `jarvis run …`, workflow presets, configured pipelines, TUI observation, and cleanup. Cross-link the v1 runbook for the few surfaces v2 does not own yet. The full TUI rendering/interaction contract lives in [`tui.md`](./tui.md).

## Which binary

`jarvis` (v2) is the daily driver: intent/plan/implement workflows, daemon, run control, TUI, and cleanup of v2 worktrees/specs. `jarvis1` (v1, maintenance-only) remains for:

| Concern | Binary | Notes |
| --- | --- | --- |
| Machine and project setup (`jarvis init`) | `jarvis` | Run from the Git worktree top level; registration merges into `~/.jarvis/config.json` without replacing an existing origin or unrelated config |
| Triage, review-feedback, prompt, runbook add | `jarvis1` | `triage --merge` gates spec-backed and spec-less PRs; see [v1 operator runbook](../../v1/docs/operator-runbook.md) |
| v1 init, patch runs (`jarvis1 run <spec>`) + their log server | `jarvis1` | Maintenance fallback only; `jarvis1 cleanup` owns v1 worktrees/specs |

Orientation: [`onboarding.md`](./onboarding.md). Install path: [`install-and-config.md`](./install-and-config.md).

## Where planning artifacts live

Check live `~/.jarvis/config.json` for `plan.targetDir`. For the jarvis project that is `v2/spec` (the default); v1 maintenance fixes use `--target-dir v1/spec`.

| Artifact | Typical path |
| --- | --- |
| Seeds (open-work queue) | `<targetDir>/seeds/` (v2 seeds: `v2/spec/seeds/`) |
| Ready intents (open-work queue) | `<targetDir>/ready-intents/` |
| Active specs | `<targetDir>/<UTC-timestamp>-<name>/` |
| Completed specs | `<targetDir>/completed/` |
| Operator scratch notes | repo `.scratch/` (gitignored) |

Open work lives in `v2/spec/seeds/` and `v2/spec/ready-intents/`; the operator prioritizes across them per-session (there is no standing queue file).

Successful publication consumes the queue input only after its durable output lands; see the [workflow publication contract](./workflow-runner.md#publication-landing).

## Status

**v2 is the primary harness.** `intent`, `plan`, and `implement` are the first-class presets; `implement` launches only when its requested spec tree has unchecked automated work. **Configured pipelines** are supported for registered projects whose `~/.jarvis/config.json` entry includes `projects.<name>.pipeline` (admission resolves the named definition and `terminalAction` before `pipeline_start`). Step-by-step operator flow for `full-review` with approval gates, failure resume, and terminal `ready` settlement lives in [Configured pipeline (`jarvis pipeline start`)](./first-workflow-walkthrough.md#configured-pipeline-jarvis-pipeline-start).

**Do not trust a `completed` status on a P0 without re-running the preset.** Multiple P0s (`implement-preflight-validates-spec-in-missing-worktree` #1417, `plan-draft-write-loop-prompt`, and two archived P0 seeds on 2026-07-12) were marked complete while the operator-visible failure survived — the fix landed one layer away from the bug (CLI preflight vs runner, prompt text vs contract). Re-run the preset before believing the status.

**An empty review log proves nothing about whether a review agent ran** — `runReviewStep` gets no `logSink`, so it logs nothing either way. Two wrong diagnoses ("the review step never invokes an agent") read that silence as evidence; telemetry shows real critic *and* actuator invocations (21–83s, `exit_kind: ok`). Do not cut a spec against a third diagnosis without observing a run. Ready-intent: `review-step-emits-log-events`.

## North star

Same as [v1 operator runbook § North star](../../v1/docs/operator-runbook.md#north-star): minimize manual steps; fold fixes into existing commands rather than new subcommands. Gaps become seeds under `v2/spec/seeds/` (or `v1/spec/seeds/` for genuine v1 maintenance fixes).

## Operator feedback cadence

Same two-point rule as v1: report when you launch a `jarvis` command and when it lands. After a landed intent (implemented and on `main`), one short session paragraph. Interrupt only for a decision you cannot make.

## Operator responsibilities

Adapted from v1; v2 session close-out is the same obligation:

1. **Drive + review + merge** v2 work through the normal PR path.
2. **Seed harness gaps** surfaced while dogfooding — link stopgaps in this runbook to the seed and a cleanup trigger.
3. **Triage harness suggestions** ([v1 runbook § Harness suggestions](../../v1/docs/operator-runbook.md#harness-suggestions-from-other-repos)).
4. **Session report** under `reports/` with UTC timestamp; link every implementation PR.
5. **Maintain this runbook** (branch → PR → merge). Operators add gotchas and remove entries when the structural fix ships.
6. **End-of-session cleanup** — run `jarvis cleanup <project>` (see [Cleanup](#cleanup-eligibility-gate) for the full contract; reserve bare `jarvis cleanup` for intentional all-registered-project maintenance).

## Runbook maintenance

v2 has no `jarvis runbook add` command. Edit this file directly:

1. Work on a git worktree (not the primary checkout).
2. Add dated bullets under **Known gotchas** or **Recovery** — terse, actionable.
3. When a seed fixes a gotcha, delete the bullet and note the seed in the PR that removes it.
4. Open a PR; do not commit runbook-only changes inside an agent spec run (they get absorbed by `git add -A`).

Template for a new gotcha:

```md
- **Short title (YYYY-MM-DD):** what happened, what to do. Seed: `v2/spec/seeds/<name>.md`.
  Cleanup: delete this bullet when `<name>` merges.
```

## Session start

1. `jarvis daemon status` — start with `jarvis daemon start` if stopped. If a harness fix merged since the daemon started, restart it first (see [Daemon lifecycle](#daemon-lifecycle)).
2. `jarvis config show` — agents listed; `machineProfile` hand-edited in `~/.jarvis/config.json` (see [`install-and-config.md`](./install-and-config.md)).
3. Verify readiness: `jarvis init --profile home` from the Git worktree root (idempotent — safe to rerun; use `--name <key>` only to select a safe explicit registry key). It bootstraps/registers as needed, then prints one `bun`/`github-auth`/`agents`/`machine-profile`/`project-registration`/`origin`/`spec-directory`/`daemon` line and exits `1` on a required check's failure — treat that report as the session-start go/no-go before starting a run.
4. Sweep for leaked test orphans before launching heavy work (see [Known gotchas](#known-gotchas) — leaked `bun test` children).
5. Review open work in `v2/spec/seeds/` and `v2/spec/ready-intents/`.
6. Sweep open [harness-suggestion issues](https://github.com/cbrenner04/jarvis/issues?q=label%3Aharness-suggestion+is%3Aopen) — **and read their comments.**

**Issue comments are not returned by default.** `gh issue list` gives titles only, and `gh issue view <n>` omits comments unless you ask for them. The owner routinely adds decisive context as a comment after filing, so triaging from the body alone will get it wrong:

```sh
gh issue view <n> --repo cbrenner04/jarvis --comments
```

Observed 2026-07-12 on intake #1453: the body proposed a full sandbox-policy architecture; the owner's comment said *"written with no familiarity with the harness — confirm assumptions prior to creating a seed."* Three core assumptions then failed against the code, and the resulting seed was a fraction of what the body asked for. See [v1 runbook § Triage](../../v1/docs/operator-runbook.md#triage-jarvis-on-jarvis-operator).

## Core operator paths

Full happy-path detail: [`first-workflow-walkthrough.md`](./first-workflow-walkthrough.md). Preset contracts: [`workflow-runner.md`](./workflow-runner.md).

### Daemon lifecycle

```sh
jarvis daemon start
jarvis daemon status    # running → exit 0
jarvis daemon stop      # when intentionally shutting down
```

Socket: `~/.jarvis/daemon.sock`. Process log: `~/.jarvis/daemon.log` (no `jarvis daemon log` subcommand yet — ready intent `daemon-process-log-read`).

**Overlapping daemons after rebuild.** When the executable is rebuilt, a new daemon with a different digest starts and automatically sends `supersede` to every other keyed daemon socket (best-effort, fire-and-forget after the new daemon's server is listening). A superseded daemon continues answering on its socket but stops admitting new `start` and `resume` requests (rejected with code `daemon_superseded`). Runs launched by a superseded daemon remain in-progress until settled; once settled, the daemon disappears on its own as callers switch to the new keyed socket. No manual stop command is needed.

**A superseded daemon's live runs are invisible to the CLI and look exactly like the deadlock shape (2026-09-02).** Each generation of a daemon on the same key binds the *same* socket path, replacing its predecessor's, so the CLI only ever reaches the newest daemon on that key. A superseded daemon keeps running the runs it owns, but those runs exist only in its memory: `jarvis run list` renders them `in-progress` + `not-live`, `run resume` refuses `terminal_run`, `run kill --force` refuses `run_not_active`, and re-dispatch refuses `worktree lock` naming the superseded daemon's PID. Every one of those refusals is correct — the reachable daemon does not own the run — but together they are indistinguishable from the [`daemon stop` / `run kill` deadlock](#known-gotchas), whose recorded recovery is `kill -9`. **Applying that recovery here destroys live work, including other projects' runs, because the daemon is shared across every registered project.** Prove liveness before concluding anything:

```sh
ps ax -o pid,etime,command | grep '[d]aemon-entrypoint.ts'   # more than one PID = superseded generations still working
lsof -a -p <agent-pid> -d cwd -Fn                            # which worktree a live cursor-agent/codex is editing
```

A `worktree lock held by process <pid>` refusal is evidence, not noise: check whether that PID is a live daemon. Observed 2026-09-02 — three implements read `not-live` with zero live rows while a 40-minute-old `cursor-agent` was actively editing one of their worktrees. Seed: `v2/spec/seeds/run-list-cannot-reach-superseded-daemon-runs.md`.

**`daemon status` reports on the *current* source digest, so a merge makes it read `stopped` (2026-07-30).** The `jarvis` launcher keys its daemon by a digest of the source tree, so every merge to `main` — including your own session's merges — rotates the key. `jarvis daemon status` probes only the current digest and prints `stopped`, while the daemon that owns your in-flight runs is alive and working on the previous key. This reads exactly like "the daemon died and my runs are orphaned," and it is not. Confirm before concluding anything:

```sh
ls -lt ~/.jarvis/daemon-*.sock          # one socket per live keyed daemon
ps ax -o comm= | grep -cE 'cursor-agent|codex-aar|claude'   # agents actually writing
jarvis run list | awk -F'\t' '$5=="live"'                   # merges across keyed daemons
```

`jarvis run list` merges across live keyed daemons, so it stays truthful when `daemon status` does not. Starting a daemon on the new digest is safe and supersedes the old one; it is not needed to rescue the old runs. The real cost is confusion, so prefer batching merges at points when no lane is live (see [Concurrency](#concurrency)).

**The running daemon predates in-session merges — restart before relying on a just-merged harness fix (2026-08-11).** The daemon loads harness code at start (and auto-bounces on stale dispatch after a merge, but the bounced process still runs the *same on-disk build* it was launched from). A fix merged this session does **not** take effect until the daemon is restarted from the operator's own shell. Symptom observed: implements kept stranding `blocked`/`contract_miss` on "Unlinked keystone checkpoints" even though the fix (#2827) was on `main`. Start any session that will re-drive fix-dependent runs with a daemon restart (operator's shell, not an agent).

### Workflow presets (registered names)

| Preset | Purpose |
| --- | --- |
| `intent` | Split seed → `ready-intents/` (one light review by default; `--review-passes 0` opts out) |
| `plan` | Draft spec tree from ready-intent (one debate review by default; `--review-passes 0` opts out) |
| `implement` | Index-routed implementation + shrink (+ review by default; `--review-passes 0` to skip) |

`intent-reviewed`, `plan-reviewed`, and `plan-reviewed-light` are **legacy aliases** (`LEGACY_WORKFLOW_ALIASES`, `v2/src/commands/workflow-args.ts`) that resolve to `intent`/`plan` and emit a migration hint. Avoid building new `*-reviewed` preset code paths (seed `workflow-composable-collapse`).

Reviewed dispatch resolves the registered layered critic and actuator artifacts at runtime, reading every staged Markdown file and spec guidance. The critic's stdout is the verdict channel, persisted at the reserved verdict path; empty verdicts skip the actuator. Completion requires that critic invocation and artifact; missing staged workspaces, unavailable bindings, boundary violations, and Git inspection errors stop with named failures instead of silently completing (boundary violation messages list unauthorized repo-relative paths verbatim).

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

For ordinary in-repo input, `--spec` is resolved from the caller's cwd (launch from the project root; a project subdirectory is supported), then checked at its resolved project-relative path in `--base` before daemon contact. If it is unavailable, commit or select a base ref that contains the spec and retry. Jarvis-owned external plan indexes use the separate [external admission contract](./workflow-runner.md#external-plan-implement-admission).

### Detached vs attached

Append **`--detach`** to any preset invocation (or `jarvis pipeline start`) when the shell should not block on completion. Detach runs the same pre-admission validation and admission path as the default attached launch; stdout is the workflow **entry** run ID (or admitted pipeline ID) only, and exit **`0` means admitted**, not that the work succeeded. Attached mode keeps the shell open through entry-terminal `wait` (pipelines loop `pipeline_wait` through `awaiting-approval` boundaries until a terminal state, then print `{kind:"terminal",state}` JSON); exit `0` there means the workflow finished. The TUI dock `start` verb is detached the same way.

**The entry run ID is not the row to wait on.** The entry frequently reports `completed` while the write row for the same spec is still `live` — the workflow continues under new run IDs (shrink, review, publication). `jarvis run wait <entry-id>` returning success is not the workflow finishing, and any run id you are handed goes stale quickly. Watch by **branch**, which is stable for the life of the work:

```sh
jarvis run list --branch <spec-dir-basename>
```

Before concluding a run committed nothing or dropped its work, check `jarvis run list` for a live row on the same branch, and see [Deciding a workflow is finished](#deciding-a-workflow-is-finished).

### Implement workflow

Before workflow loading, `jarvis run workflow implement` reads the requested spec tree. If all non-human-only criteria are checked, it may contact the daemon solely to probe a recoverable failed lineage; when none is admitted, it exits `1` with `implement.already_complete` without a worktree, agent invocation, or run row. Linked-index checkboxes are not the completion source of truth. Subspec *routing* (which link runs next) keys off the same unticked-criteria rule, so a hand-finished-and-merged subspec with a lagging index box is skipped automatically on re-run rather than needing its box hand-ticked first.

#### External plan admission and preflight

For a registered project whose `planSource` publishes to `~/.jarvis/specs/<safeId>/plans/`, launch its canonical external index by absolute path:

```sh
jarvis run workflow implement --base main --spec "$HOME/.jarvis/specs/<safeId>/plans/<name>/index.md" --review-passes 0
```

The [workflow-runner contract](./workflow-runner.md#external-plan-implement-admission) owns the admission predicate, project identity, canonical paths, base-ref bypass, and build/recovery completeness rules. On an incomplete re-run, successful preflight applies the normal stale code-worktree reset for the owning `(project, branch)`, skips worktree-relative landed-criteria comparison for the external path, and leaves the external tree intact. The command above documents support only through that successful reset boundary; do not treat admission as end-to-end agent-loop support. External linked routing, prompt access, criteria/index writes, review, and shrink are tracked by [`route-external-implement-spec-trees`](../spec/ready-intents/route-external-implement-spec-trees.md); keep review disabled until that execution contract lands and pins external verdict-path behavior.

**A git-disabled plan pipeline continues into implement.** For a registered `plan.commit: false` (or `git: false`) project, the pipeline's plan stage publishes its spec tree to `~/.jarvis/specs/<safeId>/plans/<name>/`, and the chained implement stage now dispatches against that external plan home directly — same admitted identity as the standalone command above, with code, commits, gates, and publication still on the ordinary code worktree. Plan is no longer terminal for those projects.

Before linked routing, the daemon materializes and validates the managed worktree. If that fails, it returns `worktree_materialization_failed`; the message names the managed path and the underlying Git or validation reason. Fix the checkout problem and retry: no routing read, run row, or agent invocation occurred. A later routing index read returns `routing_read_failed`; its message names the resolved index path and underlying read reason.

Remote branch presence for materialization uses `git ls-remote --heads origin <branch>` (`branchExistsOnOriginAsync` in `shared/git.ts`), not a local `origin/<branch>` tracking ref alone. `ls-remote` errors or empty output are treated as absent on the remote (fail-closed false), so offline or auth failure can bias recreation toward `--base` even when a remote branch still exists.

#### Incomplete re-run preflight gates

On an incomplete re-run with git enabled, preflight evaluates four gates in order before retiring a stale workspace for the resolved `(project, branch)`, after daemon connect and before the write step starts. The same `resetStaleWorkspace` path applies to incomplete git-enabled `implement`, `plan`, `intent`, and `intent-reviewed` re-runs. Intent has no `--reset-despite-dirty` or `--reset-despite-landed-criteria` flags; implement and plan retain those overrides. Dirty refusal diagnostics name exact lossless Git inventory paths, including whitespace, newline, and non-ASCII names. Untracked `.jarvis-*` harness sidecars (for example intent review verdict files) and the materialized worktree-root `node_modules` symlink do not count toward the dirty gate. When intent's write step carries a directory `specPath` (for example `spec/ready-intents`), the landed-criteria gate is N/A; only readable spec files and `index.md` trees participate.

1. **Descendant check** — managed worktree `HEAD` must be a descendant of the resolved `--base` (implement) or repository base (plan). Refusal names the base ref, resolved base `HEAD`, worktree `HEAD`, and `stale reuse refused`.
2. **Preserve landed criteria** — refuse when the worktree spec tree has non-human-only acceptance criteria ticked that are unticked on `--base`; stderr names those subspec paths. `--reset-despite-landed-criteria` skips only this gate.
3. **Dirty reuse** — refuse when the worktree has uncommitted tracked or untracked paths; stderr names paths and recovery (`--reset-despite-dirty` skips only this gate).
4. **Retirement** — remove the materialized worktree, delete the local branch, delete the remote branch, prune a stale `origin/<branch>` remote-tracking ref when it still resolves locally, then close the matching open draft PR (when exactly one exists). Implement rematerializes from its explicit `--base`; plan rematerializes from its resolved repository base. The sequence aborts at the first failing step. First runs with no existing worktree skip this path.

When gates (2) and (3) both apply, stderr names landed-criteria drift before dirty reuse. When gate (1) refuses with `--reset-despite-dirty` set, stderr still names dirty paths for context. Neither override flag overrides the descendant check. When automatic re-run reset is refused (live-held, PR, descendant, operator dirty work beyond harness sidecars), `jarvis cleanup --abandon` remains the manual fallback — re-run alone does not always clear a poisoned intent verdict tree.

Two kinds of `1` exit come out of this path, and they are not the same state:

- **Pre-mutation refusal** — nothing was touched. Raised when the workspace is live-held, the matching PR is ready (non-draft), multiple open PRs match the branch, the daemon already holds the `(project, branch)` claim that would refuse workflow `start` (`worktree_claimed:` on stderr; worktree, local and remote branches, and open PR stay intact), the daemon claim-check RPC fails (generic `Cannot re-run incomplete spec:` wrapper — not `worktree_claimed:`; no retirement), the managed worktree `HEAD` is not a descendant of the resolved base, the worktree spec tree has criteria ticked absent from base, or the materialized worktree has uncommitted tracked or untracked paths; stderr names the blocking state. Recovery: end the live run or wait for its lock to clear; mark the PR draft again or merge it; close duplicate PRs until exactly one open draft remains; or clean the worktree as named in the refusal (commit, discard local changes, or pass the matching override flag), then re-run. Manual fallback: `jarvis cleanup --abandon <branch>` when guards pass.
- **Partial teardown** — stderr reads `retirement failed at <step>; <what remains>`. Local artifacts may already be gone. Finish the teardown by hand (see [`--abandon`](#v2-debris-blocks-the-jarvis1-fallback) for the per-step remnants and commands), then re-run. When any retirement step destroyed artifacts before the invocation exits non-zero, stderr also prints a `Retirement destroyed artifacts:` block listing each destruction event from this invocation (closed PR number, worktree path, local branch, remote branch, pruned remote-tracking ref) — not a live re-probe of git or GitHub. A started run may have recreated the worktree and branch after retirement; treat the summary as a teardown log, not current state. Because the guard runs after connect, a refused re-run leaves behind the daemon it auto-started when none was listening — stop it with `jarvis daemon stop` if you did not want one up.

Pipeline intent-stage re-dispatch (reopen/resume after a failed-stage continuation, including daemon-restart continuation) auto-clears a poisoned intent worktree and review-verdict sidecar the same way, when the same gates pass — no manual step. When a gate refuses (dirty tree, criteria drift), the stage fails with the CLI's refusal text instead of dispatching; run `jarvis cleanup --abandon` to retire the worktree by hand, same as any other refused-guard or non-pipeline case.

### Pipeline start

Launch a registered project's configured pipeline when `projects.<name>.pipeline` is present and valid in machine config (`jarvis run workflow implement` ignores `pipeline` entirely):

```sh
jarvis pipeline start <project> --seed-text "Ship feature"
jarvis pipeline start <project> --seed path/to/seed.md
jarvis pipeline start <project> --seed-text "Ship feature" --detach  # return after admission; track via printed pipeline ID
```

`--seed <path>` matches standalone intent `--seed` (slug, `landing.inputs.paths`, worktree consumption); `--seed-text` is inline-only (`seedText`, no seed-file deletion).

Plan completion records a bare spec **directory** on the stage artifact; chained implement resolution normalizes that to `<dir>/index.md` in `resolveImplementStage` before any workflow run row exists. A directory without `index.md` on the plan worktree fails at stage resolution (`failure_detail` with `pipeline-stage-resolve:` prefix, worktree-relative path, index-expected wording) — not later as `Non-index spec requires --artifact` from the implement builder.

**Chained stage PR bases.** Chained plan and implement stages each open draft PRs against the repository default branch (`getBaseBranch` / `main` fallback), not stacked on the prior stage branch. Implement preflight still probes `prior.branch` for spec availability only. During chained implement, linked-index routing reads and writes the spec tree on the prior stage worktree (`specReadRoot`); completion publication lands that tree into the default-branch implement worktree before commit so index ticks and subspec edits appear on the implement draft PR. In-flight pipelines admitted under stacked `baseRef` may still hit publication-time base retarget when the requested base vanishes on `origin`; settlement records `requestedBase` / `resolvedBase` when retarget applies.

### Pipeline list and wait

After a detached start, prefer the daemon's operator-notification sink (see [Operator notifications](#operator-notifications)) to learn when a pipeline reaches a gate or terminal boundary. For foreground blocking or one-off inspection, use wait or list:

```sh
jarvis pipeline wait <pipeline-id>                # block until terminal or awaiting-approval
jarvis pipeline list                              # one JSON snapshot; does not follow live work
```

`jarvis pipeline list` mirrors daemon `pipeline_list` in one stdout line. Pipeline rows include identity, derived state, optional admitted `terminalAction`, optional unchanged durable admission `seedPath`, and nullable terminal-publication success/failure. A relative `seedPath` remains relative to admission `cwd`; the snapshot does not expose `cwd`. Ordered stages include durable `id`/authored `position`, lifecycle fields, `artifact`, and `failureDetail`, preserving nullable and falsy JSON diagnostics. A terminal `failed` workflow stage never names a still-live entry run in `workflowInvocationId`; terminal rows may retain the settled entry-run id. The CLI issues a single non-blocking snapshot RPC with no client-side polling — use it for point-in-time snapshots, not completion tracking. Typical end-to-end latency stays within the daemon's **500ms** snapshot bound even when pipelines are still running (`daemon-pipeline-observation.test.ts`); the CLI does not enforce that ceiling by waiting or polling.

Dismissed pipelines are hidden by default. Add `--all` to see them too — it widens the request to `{ includeDismissed: true }` and appends a trailing `dismissed`/`-` column to the human listing (present only under `--all`). `--all` composes with `--since`/`--state` (filtered out of the widened set) and with `--json` (which passes the widened snapshot through unmodified, `dismissedAt` included, no synthetic marker field) — it does not lift the existing `--json`+`--since`/`--state` incompatibility. A default listing where every pipeline is dismissed still prints `No pipelines.`, with no hidden-count hint; reach for `--all` to check.

`jarvis pipeline wait` prints one boundary JSON line per invocation. Exit **`0`** on `awaiting-approval` or terminal `succeeded`; non-zero on other terminal states. Approval boundaries name `{kind:"awaiting-approval",stageId,branchKey}`. On fan-out pipelines, wait may stay non-terminal while a sibling branch workflow is still `running` or a reachable gate remains undecided — terminal `failed`/`rejected` return only after every branch has settled. Re-run wait after approving a gate; attached start loops internally instead. Operator abort (SIGINT) during wait follows the same pattern as `jarvis run wait`: stderr connection detail, non-zero exit, no boundary JSON on stdout.

### Pipeline approve and reject

Read the deciding `stageId` and `branchKey` from `pipeline wait` boundary JSON (`{kind:"awaiting-approval",stageId,branchKey}`) or from `pipeline list` stage rows (`status: "awaiting"`). Admit or reject the named branch gate:

```sh
jarvis pipeline approve <pipeline-id> <stage-id> <branch-key>
jarvis pipeline reject <pipeline-id> <stage-id> <branch-key>
```

Single-default-branch pipelines use `branchKey: "default"`. On an already-running admitting daemon, `approve` advances the successor immediately — no daemon restart or startup continuation sweep is required. After an intent split, each branch row carries its own `branchKey` — approve or reject one branch without affecting sibling gates. Post-approve successor dispatch is scoped to the approved `branchKey` only: sibling gates stay `awaiting` and sibling stages are not dispatched until their own gate is approved. Exit **`0`** on `kind: "applied"` means the decision was durably admitted, not that the pipeline finished — pair with `pipeline wait` or `pipeline list` for progress. Refused duplicate or stale decisions (`invalid_decision`, `status_not_awaiting`, `branch_key_required`, etc.) print the daemon `reason` verbatim on stderr and exit non-zero with no success stdout. Re-run `pipeline wait` after a successful approve to observe the next boundary.

**Landing pipeline stage PRs (operator practice).** `approve` advances the gate but does not merge the approved stage's PR. Sharp gotcha: the plan workflow only `git mv`s its ready-intent into the spec's `intent.md` when the ready-intent is on the plan stage's base — the pipeline plan stage targets the repository default branch pinned at admission, not current main, so merging the intent PR at `approve-intent` does not trigger the move (verified 2026-08-31, pipeline `45f78585`). Do not rely on merge-at-gate to trigger the move until the base-rebase seed ships. Practical landing: merge each stage PR to the repository default branch in stage order, or merge the terminal implement PR and close earlier stage PRs once their content is subsumed. Seeded: `merge-pipeline-stage-pr-at-its-approval-gate` (needs approve-time intent merge and plan-stage base rebase). Cleanup: delete this note when that seed ships.

### Pipeline resume

Re-enter a failed or `awaiting-approval` pipeline without starting a new one:

```sh
jarvis pipeline resume <pipeline-id> [<branch-key>]
```

Use **`pipeline resume`** (not `pipeline start` or `jarvis run resume`) when a pipeline stalled at a failed stage or an approval gate and you want the daemon to reopen or claim continuation from persisted admission context. Recovery eligibility (admitted vs refused vs no-effect, branch scope, deferred settlement, missing context, terminal states): [`pipeline-execution.md` § Operator recovery](./pipeline-execution.md#operator-recovery). Exit **`0`** on `kind: "resumed"` means the daemon admitted detached continuation, not that the pipeline finished — pair with `pipeline wait` or `pipeline list` for progress. Terminal pipelines (`pipeline_terminal_succeeded`, `pipeline_terminal_rejected`) and other refusals print the daemon `reason` verbatim on stderr and exit non-zero. Failed resume replays from the failed stage (preserving predecessor invocation IDs); awaiting resume claims the pipeline without dispatching past the gate — approve the gate separately, then `pipeline wait`. When approval continuation was lost after the gate already reads `approved`, `pipeline resume` dispatches the pending successor via `continuePipeline` without reopening a failed stage (whole-pipeline and explicit `default` only when aggregate derived state is not `awaiting-approval` or `running`; mixed fan-out with siblings still awaiting or running uses branch-scoped resume). When a chained `plan` or `implement` stage failed because the prior entry-run worktree directory was removed (for example after `jarvis cleanup --abandon` to clear a dirty gate), `pipeline resume` re-resolves the downstream input from the durable prior branch (or pipeline admission base) and dispatches — clearing the worktree no longer permanently strands resume.

A resumed failed `plan` redraft automatically retires ordinary uncommitted `.jarvis-plan-stage/` draft dirt and rematerializes the lane from base before dispatch; whole-pipeline and branch-scoped resume need no preceding `cleanup --abandon`. Branch-scoped resume resets and dispatches only the named lane — sibling approval gates and stages stay untouched. Reset policy survives detached continuation, claim loss, and daemon restart via a durable row marker until dispatch completes. The worktree is preserved and the stage fails without dispatch when a live run/worktree owns it, staged `intent.md` still carries a non-reserved operator `## Blocker` (reserved harness `Artifact contract check failed:` sections are cleared with draft dirt), stale-reset preparation cannot run, `HEAD` is not descended from base, or landed acceptance criteria differ from base. Resolve the named state first; reserve `jarvis cleanup --abandon <branch>` for those preserved refusals or partial teardown, and use `pipeline recover` instead when the corrected staged tree should be landed rather than discarded.

`pipeline resume` also recovers a stage wedged `running` whose linked entry run is durably terminal — see [Wedged pipeline-stage settlement after daemon death](#wedged-pipeline-stage-settlement-after-daemon-death) for that contract (marker and no-marker shapes, the two-resume case, and PR-evidence preservation).

Add the branch key when a single approved branch's stage failed on a fan-out pipeline while sibling branches still sit at their own gates — the unscoped form only derives `awaiting-approval` on such a pipeline and never reopens the failed branch. Branch-scoped resume touches only that branch's rows; sibling gates and stages are untouched. The CLI prints only the daemon `reason` string, not `branchKey`/`stageId`; a `branch_awaiting_approval` refusal means resume raced an unresolved decision on that branch — look up the gate's stage ID via `pipeline list` or `pipeline wait` boundary JSON, approve or reject it, then resume or `pipeline wait` again. Omitting the branch key keeps whole-pipeline resume unchanged.

### Pipeline recover

Revalidate a hand-corrected blocked branch plan stage without redrafting it:

```sh
jarvis pipeline recover <pipeline-id> <branch-key>
```

1. Read the blocked branch's stage row and its `workflowInvocationId` from `jarvis pipeline list --json` — the row must be a `failed` `plan` stage.
2. Look up that run's `worktreePath` from `jarvis run list` or `jarvis run wait <run-id>`.
3. Correct `<worktreePath>/.jarvis-plan-stage/` by hand, and remove any operator-authored `## Blocker` section from the staged tree — recovery always refuses `operator_blocker` when one remains.
4. Run `jarvis pipeline recover <pipeline-id> <branch-key>`.
5. Read the settled outcome afterward from `jarvis pipeline list --json` (`status`, `artifact`, `failureDetail`) on the same stage row — the command returns at admission, before the attempt runs.

Use **`pipeline recover`** (not `pipeline resume`) when the blocked stage's staged tree is already correct and you want the daemon to revalidate and land it as-is. Resolution refusals, claim contention, and attempt-time blockers: [`pipeline-execution.md` § Operator recovery](./pipeline-execution.md#operator-recovery). The branch key is mandatory and may name any fan-out lane, including a non-first lane. Recovery lands that lane's corrected staged tree without invoking its plan write step; sibling lanes and their approval gates stay unchanged. `pipeline resume` instead reopens the row and redispatches the stage through its ordinary write step — it redrafts, discarding the correction. `pipeline recover` is also distinct from `pipeline approve`/`reject`, which admit gate decisions rather than revalidate a stage. Exit **`0`** on `kind: "admitted"` means the correction was accepted for detached revalidation, not that recovery succeeded. `resolution_refused` (`<reason>: <message>` on stderr — for example `no_failed_stage`, `stage_not_plan`, `stage_not_linked`; see [`daemon-host.md`](./daemon-host.md#branch-scoped-blocked-plan-stage-recovery) for the full reason list) and `stage_claimed` (another recovery or dispatch already holds the stage) both refuse before any attempt runs; `operator_blocker` is instead `recoverPlanStage`'s own attempt-time refusal (step 3 above) — it lands after admission and settles the stage row `failed` in place, visible only via step 5, not on the command's exit.

### Pipeline dismiss and undismiss

Hide a pipeline you no longer want listed, without deleting it:

```sh
jarvis pipeline dismiss <pipeline-id>
jarvis pipeline undismiss <pipeline-id>
```

Dismissal only hides the pipeline from `pipeline list`'s default output — it does not delete the durable row; see it again with `jarvis pipeline list --all`, or in the TUI via the **`D`** toggle ([`tui.md` § Dismissed rows](./tui.md#dismissed-rows)). `pipeline resume`, `pipeline recover`, and daemon-restart recovery still reach a dismissed pipeline the same as before. Dismissing a live (`pending`, `running`, or `awaiting-approval`) pipeline succeeds and prints a stderr warning naming the pipeline and its state; dismissal does not stop it. `undismiss` never warns. Refusals (for example an unknown pipeline ID) print the daemon `reason` verbatim on stderr and exit non-zero, with no confirmation. Dismissal is a display filter, not retention — see the `pipeline-list-display-retention` seed for the separate unbounded-row-growth concern.

### Run dismiss and undismiss

Hide a dead ad-hoc or workflow-entry run you no longer want listed, without deleting it:

```sh
jarvis run dismiss <run-id>
jarvis run undismiss <run-id>
```

Both connect on the invoking digest's socket only — no cross-daemon owner discovery like `run log` / `run wait` — so dismiss/undismiss a run through the operator's own reachable daemon, same as `pause`/`resume`/`kill`. Every keyed daemon opens the same durable state store, so this reaches the same row regardless of which daemon started the run.

Dismissal only hides the run from `run list`'s default output — it does not delete the durable row, and does not stop it; see it again with `jarvis run list --all` or the TUI **`D`** toggle. `run wait`, `run kill`, `run pause`, `run resume`, `run log`, `jarvis cleanup`'s daemon-list safety reads, and reconciliation all still reach a dismissed run; a dismissed but live run stays invisible in `run list` while still blocking worktree retirement the same as an undismissed one. Dismissing a live (`in-progress`, `budget-soft-stopped`, `paused`, or `queued`) run succeeds and prints a stderr warning naming the run and its status; `undismiss` never warns. Refusals print the daemon `reason` verbatim on stderr and exit non-zero.

A workflow-entry run's step rows each carry their own `dismissedAt` — dismissing the entry row does not dismiss its steps, so shedding a whole invocation means dismissing each row individually; dismissed step rows are still folded back in when the daemon indexes listed runs for invocation display.

### Ad-hoc write loop (live pause/kill)

`jarvis run start` with explicit worktree fields — supports `pause` / `kill` / `resume` on the active run. Workflow-started implement supports live `kill` only; `pause` / `resume` remain write-loop-only. See [first-workflow-walkthrough § Workflow-started implement](./first-workflow-walkthrough.md#workflow-started-implement) and [`daemon-host.md` § Live controls](./daemon-host.md#live-controls-on-workflow-started-runs).

### Observe

| Command | Use |
| --- | --- |
| `jarvis tui` | Split-pane monitor: unified work tree (pipelines → branches → stages → runs, plus ad-hoc invocations), needs-attention queue, 4-line dock with typed steering verbs. Full contract: [`tui.md`](./tui.md) |
| `jarvis run list` | JSON-ish run rows; `isLive` vs durable `status`; merges every live keyed daemon, deduped by run ID — but only the newest generation *per key* is reachable, so a live run on a superseded same-key daemon renders `not-live` (see [Daemon lifecycle](#daemon-lifecycle)) |
| `jarvis run list --since <duration\|timestamp>` | History query past the default fifty-terminal-run window; duration units `d`/`h`/`m`/`s` (e.g. `2d`, `90m`) or absolute Unix ms / ISO 8601 |
| `jarvis run list --project <name>` / `--branch <name>` / `--spec <path>` | Exact durable field match (case-sensitive); bypasses the fifty-terminal-run retention window |
| `jarvis run list --status <terminal-status>` | Exact terminal durable status (`completed`, `failed`, `blocked`, `interrupted`, `killed`); bypasses retention |
| `jarvis run list --since … [--limit <n>]` | Filtered history query: optional `--limit` caps matching rows (default **200** newest per keyed daemon before the CLI merges sockets, so merged output can exceed 200); dimension flags compose conjunctively with each other and with `--since` |
| `jarvis run list --limit <n>` | Without a filter, the daemon does not use `limit` to reduce rows: row count and retention match plain `jarvis run list` (fifty-newest terminal policy) |
| `jarvis run list --all` | See dismissed runs too — widens the request to `{ includeDismissed: true }` and appends a trailing `dismissed`/`-` column. Composes with `--since` and the dimension filters. Not a filter field itself, so a bare `--all` still takes the fifty-newest-terminal retention path, where dismissed rows compete for the same slots — `--all` is not guaranteed to be a superset of the default listing |
| `jarvis run wait <run-id>` | Block until next boundary |
| `jarvis run log <run-id>` | Structured run log (not daemon process log); snapshot only — replays persisted records and exits once the daemon closes the stream, even for a live run |
| `jarvis run log <run-id> --follow` | Same replay, then keeps tailing new records until the followed run settles or the client disconnects |
| `jarvis tui log <run-id>` | Interactive tail; reads across live keyed daemons (auto-discovers owner, resumes across transport loss) |

Key TUI bindings: **`j`**/↓/↑ walk the painted tree; **`e`** expands/collapses a pipeline, stage, or branch node; **`k`** kills a live run; **`D`** toggles dismissed rows for the session; **`:`**/**`/`** focus the dock command input (verbs: `start`, `expand`, `collapse`, `approve`, `reject`, `resume`, `kill`, `pause`, `resume-run`, `log`); Enter on a selected needs-attention row reveals its target. All dock steering is detached (one RPC, no wait). Details, feedback codes, and rendering rules: [`tui.md`](./tui.md).

`list` / `wait` operator errors: [`daemon-host.md` § Operator error](./daemon-host.md#operator-error-on-list-and-wait). `contract_miss` rows also expose `error.contractMissDetail` when the run log's chronologically last `contract_miss_detail` event carries `failureReason` (plan-draft normalizer text, for example); `jarvis run log` remains the full excerpt. Omitted when the log tail cannot be read (store-only / no `logReader`).

Durable state: `~/.jarvis/state/v2.sqlite` ([`state-store.md`](./state-store.md)).

#### Operator notifications

Configure a top-level `notificationSinkCommand` in `~/.jarvis/config.json` (see [install-and-config.md](./install-and-config.md#operator-notification-sink)). The daemon derives operator-actionable incidents from durable rows, diffs them against a delivery ledger, and spawns your command fire-and-forget with one JSON incident per stdin write. Dedupe key is `(incidentId, transition)` — a pipeline that reaches a gate and later fails notifies twice. Prefer this over inventing `run list` / `lsof` poll loops for backgrounded work. Full sweep placement and multi-daemon semantics: [daemon-host.md § Operator notifications](./daemon-host.md#operator-notifications).

#### Deciding a workflow is finished

**Primary path: configure `notificationSinkCommand` in `~/.jarvis/config.json` and let the daemon push.** A live daemon sweeps derived operator incidents after startup reconciliation, on a five-second timer, and after state transitions. Each owed `(incidentId, transition)` fires your shell command once with one JSON object on stdin (`kind`, `pipelineId`/`runId`, `transition`, `cause`, …). Pipeline approval gates, terminal pipeline outcomes, publication failures, wedged settlement, blocked runs, budget-soft-stops, and ad-hoc workflow terminals surface at derived altitude — not as a burst of per-step run rows. See [install-and-config.md](./install-and-config.md#operator-notification-sink) and [daemon-host.md § Operator notifications](./daemon-host.md#operator-notifications). Without a sink configured the sweep still advances the delivery ledger silently; nothing spawns.

**Foreground blocking:** `jarvis pipeline wait <id>` and `jarvis run wait <id>` remain the right tools when you are already attached and want the CLI to block until a boundary.

**Fallback diagnosis only** — do not build session wait loops on these; use them when a notification was missed or you are debugging:

- **Post-completion mutation verification can lag every "done" signal.** Attached `jarvis run workflow` exit, `jarvis run list` showing every row `completed` / `not-live`, and an idle run table can all read finished while verifiers still run in the worktree. While either verifier runs, the tree may contain deliberately broken source. Before hand-finishing, confirm no live work remains.
- **Match on any process, not on `bun`.** One-shot: `lsof +D ~/.jarvis/worktrees/<project>/<branch> | tail -n +2 | awk '{print $1}' | sort -u`. **Do not poll `lsof +D` on a loop** — it is expensive. To estimate fleet settle, count agent processes once: `ps ax -o comm= | grep -cE 'codex|cursor-agent|claude'`.
- **Match the `live` field, never grep the substring.** `grep -q "live"` matches `not-live`. Use `jarvis run list | awk -F'\t' '$5=="live"'` for a one-off check, not a polling loop.
- **`in-progress` + `not-live` is normal during publication-and-gate tail** (~8–15 minutes for a full aggregate suite). Check `jarvis run log <id>` for `loop_finished` before concluding a strand.
- **Publication row dispatches late.** A settled write+review pair with no PR yet does not mean publication was skipped. Check `jarvis run list --branch <spec-dir>` for the publication row before hand-finishing.
- **`jarvis run log` records lifecycle events, not the agent stream.** Silence there is not evidence of a stall.
- **An empty query result is not evidence.** Prove malformed queries (`grep "live"` matching `not-live`, wrong telemetry keys, sandboxed `git`/`gh`) before concluding absence.

### Worktrees and branches

v2 git-enabled workflows use `~/.jarvis/worktrees/<project>/<branch>/`, not `<repo>/.worktree/`. Intent branches: `intent/<slug>`. Plan branches: `plan/<name>`. Implement branch defaults to the spec directory basename.

Merged worktrees and eligible merged local branch refs are retired by `jarvis cleanup` (see [Cleanup: eligibility gate](#cleanup-eligibility-gate)). A leaked worktree from a **failed/unmerged** run is reset automatically on the next incomplete `implement` or `plan` re-run (see [Incomplete re-run preflight gates](#incomplete-re-run-preflight-gates)); for manual cleanup when guards pass, use `jarvis cleanup --abandon <branch>`.

A hand-created worktree (e.g. under repo `.scratch/`) has no `node_modules`; tests that spawn package bins then fail with misleading errors (`completion-commit.test.ts` spawning `bun biome check` dies with "Bun cannot run json files directly"), while typecheck and imports still resolve through the parent directory and hide the gap. After `git worktree add`, immediately `ln -s <repo>/node_modules <worktree>/node_modules` — the same link the harness materializes in managed worktrees.

If a failed materialization leaves an ordinary directory at its managed path, retry the workflow: v2 removes that proven unregistered non-Git husk and rematerializes it under the same branch lock. It refuses and leaves the path intact when Git recognizes it as a worktree, the target repository still registers it, or Git ownership/validation is inconclusive; inspect that state before manual removal. Incomplete implement and plan re-dispatches defer this non-Git husk to locked materialization, with or without `--reset-despite-dirty`. Other `git status` listing failures still refuse before any retirement; the override applies only to a successful dirty listing.

## Implementation on jarvis specs

Two valid paths:

1. **`jarvis run workflow implement`** — the primary path; live `jarvis run kill` stops an in-flight write step; verify preflight and gates independently.
2. **`jarvis1 run <spec>`** — v1 maintenance fallback (patch loop, triage, cleanup integration).

Do not assume parity between them — see [Gate trust](#gate-trust) for what the v2 gate covers.

### Review-role timeouts and stalls

**Binding-chain invocation errors.** When a binding-chain `invocation_failure` persists the final binding's bounded stderr tail, `jarvis run list` / `wait` include it verbatim at `error.message` on the `invocation_error` operator error. Message-less and legacy rows omit `error.message`.

**Wall-clock escalation.** A review step whose role invocation exceeds its per-role wall-clock bound escalates internally to the next configured rung (agent/model binding) in the flat list — same as a quota fallback — before settling anything on the run row. The wall clock and idle budget are armed once per escalation **segment** (one `executeWithQuotaFallback` call over the remaining binding suffix), not once per rung: a rung reached by in-segment quota advancement shares the rest of that segment's clock; only a rung that starts a new segment (after a prior segment timed out) gets a full fresh `roleTimeoutMs`. Worst-case wall time for one role invocation is bounded by segment count and is N × bound across N configured rungs only when every rung times out with no in-segment quota advancement between them.

**Exhausted `role_timeout` is terminal.** Only after **every** configured rung times out (including a single-binding list) does the step settle `invocation_failure` with `failureKind: "timeout"`, `exhaustedRoleTimeout: true`, and `bindingAttempts` naming every rung tried in profile order (`bindingId`, `agent`, `model`, `resultKind` — rungs actually aborted by the wall clock report `"timeout"`; a rung consumed by quota before the abort reports its real result kind, e.g. `"quota"`). A mixed quota/timeout outcome keeps `exhaustedRoleTimeout: false` and the retryable `role_timeout`/`retry_later` mapping instead — a quota-consumed rung may succeed on re-dispatch. An exhausted settle is terminal: `resumable: false`; `jarvis run list` / `wait` report `error.reason: "role_timeout"`, `retryable: false`, `nextAction: "stop"` (distinct from write-loop `iteration_timeout`). It reproduces deterministically — a re-dispatch spends the same N × bound to reach the same wall — so recovery is changing the rung config (raise the bound, add/reorder rungs) and starting a fresh run, **not** re-dispatching the same workflow and **not** `jarvis run resume` (which hard-errors on a `failed` run that is not publication-retry-eligible). Inspect the worktree first — the aborted actuator's partial edits are still on disk and are **not** swept into any later completion commit: the dirty-worktree gate refuses a fresh run over the same worktree, and `--reset-despite-dirty` discards them. Salvage anything worth keeping before starting fresh.

Review re-dispatch does not re-resolve implement write-step bindings — only write-loop `resume`, recovery, queue promotion, and fresh write admission pick up a rung edit (confirm via attempt telemetry until `jarvis run list` reports binding). Actuator-only retry (below) likewise keeps the workflow snapshot from the original dispatch, so a config edit between dispatches is not picked up.

**Idle-output stalls (`role_stalled`).** An idle-output watchdog on the same review-role invocation times out when a role produces neither output nor qualifying worktree file activity for the machine-wide `idleOutputTimeoutMs` budget: a configured positive value arms it, an absent key uses the 90_000 ms fallback, and `0` disables it. Creates, modifications, and deletes under the invocation `cwd` re-arm the timer, so a silent-but-editing role stays live; harness metadata sidecar writes (any `.jarvis-*` path segment except workflow staging directories `.jarvis-plan-stage/` and `.jarvis-intent-stage/`, plus `verdict-*.md` basenames) do not. A stall settles `invocation_failure` with `failureKind: "stall"` on the durable successor row (`review` / `review-debate`); `jarvis run list` / `wait` on that row's `runId` report `error.reason: "role_stalled"`. Entry step-0 `runId` wait/list does not project sibling review `role_stalled` — use `list` filtered by branch and `stepId` (or wait on the successor `runId`) to read stall detail and `retry_later`. Unlike `role_timeout` (wall-clock from start), `role_stalled` reflects inactivity, does not escalate through rungs, and is retryable (`retry_later`); recovery is re-dispatching the same workflow. The write path's own idle-output watchdog settles a distinct `idle_output_timeout` on write-step/reprompt invocations: when the boundary checkpoint produced a fresh `iteration_commit` `commitSha`, terminal `loop_finished.resumable: true` projects `error.nextAction: "resume"` and recovery is `jarvis run resume` on the retained workspace; when no checkpoint commit exists (`resumable: false`), `nextAction: "stop"` — re-dispatch the workflow after inspecting `jarvis run log`.

**Successor-shell idle bounds** fence pre-agent stalls on durable `review` and `review-debate` steps (including actuator-only retry). The shell arms from `idleOutputMs` immediately after `iteration_started`; absent key → 90 s, `0` disables. The shell hands off to role-layer idle bounds at first `invokeReviewRole` entry. Shell idle exhaustion settles `invocation_failure` with `failureKind: "stall"` (no `agent`/`model` when no role ran), `loop_finished` with `resumable: true`, and releases the `(project, branch)` claim — reported on the **successor row**, not the step-0 entry `runId`.

Post-commit review `role_stalled` preserves the completion commit and adjudicated verdict on disk; recovery is re-dispatching the same workflow, not `jarvis run resume`. An exhausted `role_timeout` also preserves the completion commit and verdict, but is not resumable and not worth re-dispatching — see above.

**Actuator-only retry (`review-debate` patch review).** Admitted only for a post-commit retryable failure kind — today that is exhausted-rung-exempt `role_stalled`; an exhausted `role_timeout` never reaches this path. When the failed role was specifically the **actuator** on a `review-debate` step and the failure kind is admitted — the debate roles already settled a verdict at `verdictPath` before the actuator ran — re-dispatch does not replay the adversary/advocate/adjudicator chain or the hidden `~shrink` pass. It reuses the same review run row and re-invokes only the actuator against the persisted verdict, so recovery is a single role invocation. A debate-role failure (adversary, advocate, or adjudicator) always re-dispatches the full debate cycle on a fresh run row. If `verdictPath` is missing or empty at retry time (e.g. a worktree reset removed it), the re-dispatch settles a named, non-retryable error instead of silently falling back; that settled failure carries no actuator role, so the *next* re-dispatch replays the full debate cycle on a fresh run row, regenerating the verdict itself — no manual verdict recreation needed. Multi-cycle review (`reviewPasses` > 1) never takes the actuator-only path, even when the last attempt failed at the actuator — an intermediate cycle's actuator retry would report the step complete and silently drop the remaining cycles; recovery there is always the full debate cycle.

`jarvis run list` / `wait` project `resumable` from the same admission predicate as `jarvis run resume` (`nextAction: "resume"` on the composed operator error). A row advertising `resumable: true` is admitted; a `terminal_run` refusal names the owning recovery for the composed `error.reason`, not only the durable status. Trust the row's current `resumable` projection, not a historical `loop_finished` record still claiming `resumable: true` — immutable log history is never rewritten, only re-read through the current resolver.

## Gate trust

v2 implement completion runs three mechanical gates: diff-derived mutation verification, runtime smoke verification, and the green ready gate. Implement discovers uncovered changed guards in-loop at `done`/`no-work` first (live-agent `write.surviving-mutation-reprompt` before completion commit or publication); publication then re-checks confirm-only for repair-introduced survivors.

**They do not replace review (corrected 2026-07-21).** On 2026-07-21, three of five implement PRs passed all three gates — plus green CI, fully ticked criteria, and in one case an automatic draft→ready flip — while carrying defects that only independent diff review caught (a review checkpoint reused across dispatches, a durable-step exclusion rendering live review rows as `invocation_failure`, a finalization path stranding rows `in-progress`). Mutation verification proves changed guards are *covered*; it cannot judge whether a transition is *correct*. Run the review step, and read the diff. Delegate that read to an independent subagent reviewer where available, and prompt it with the specific prior failure when there is one — on 2026-07-16 a vacuous `jarvis cleanup` suite shipped twice (7/7 AC, green gate, green CI, two different models) and only a prompted diff review caught it. Distrust a green suite on code that reaches a filesystem or process root with no injection seam — that shape admits no honest test — and treat any criterion the agent grades itself on ("tests fail against pre-change code") as unverified.

**Diff-derived verification stall (fixed vs residual).** In-loop and publication-time diff-derived verification no longer re-run the whole-diff CI script union per mutation candidate — the prior `shared/**` aggregate-scope fan-out could exhaust `MAX_VERIFICATION_MS` and strand finalization `in-progress` after correct code landed. Each candidate now runs only its resolved killing-test union via `bun test` (co-located exact-stem and sibling tests plus direct-importing `*.test.ts` under the surface-prefix scan root; see [workflow-runner.md](./workflow-runner.md)); changed registered prompts resolve only mapped render-observer test file(s) from the verification worktree's `shared/prompts/render-observer-tests.ts` (see [write-behavior.md § Diff-derived mutation verification](./write-behavior.md#diff-derived-mutation-verification)); `MAX_CONCURRENT_VERIFIER_TEST_RUNS` (4) caps parallel verifier-launched `bun test` subprocesses. Diff-derived scope is narrower than the ready gate by design — a thin killing test can miss what the full gate union would catch. A mis-derived candidate whose `originalText`/columns no longer match the source line is skipped (recorded in `PassResult.skippedCandidates`) rather than crashing the run as `run_execution_failed`; the underlying guard-flip slice bug is tracked in `guard-flip-derivation-crash-is-contained`. **Residual risks:** subprocess hang, missing killing coverage (`missing-killing-test` / `importer-discovery-cap-exceeded` when same-root `*.test.ts` sprawl exceeds the per-file 200-candidate importer bound), missing render-observer map entry (`missing-render-coverage`), deadline exhaustion across many cheap candidates within `MAX_VERIFICATION_MS`, or a hung `bun test` child. Salvage: inspect `jarvis run log <id>` for `surviving_mutation_reprompt` (in-loop miss) or `surviving_mutation_failed` with those mutation kinds; add co-located or direct-importing killing coverage, reduce same-root `*.test.ts` sprawl under the scan root, add or repair the worktree observer-map entry (no merge or daemon rebuild required — see [write-behavior.md § Diff-derived mutation verification](./write-behavior.md#diff-derived-mutation-verification)), kill orphaned `bun test` children if CPU is pegged (see standing rule below), then let the live agent fix in-loop or `jarvis run resume` on the implement write row after committing fixes. For `missing-render-coverage` on a registered prompt whose diff only bumps frontmatter metadata or deletes in-file body lines (no body `add` lines), ensure mapped observers assert on the unmutated post-change rendered output — sentinel mutation does not apply on those exempt paths (canonical contract: [write-behavior.md § Diff-derived mutation verification](./write-behavior.md#diff-derived-mutation-verification)). Publication-time survivors after ready-gate repair use review `write.mutation-repair` admission instead. Checkpoint `@mutate` verification during the write step keeps package.json script scope and separate wall-clock accounting.

### Completion honesty

A v2 implement run reporting `runStatus: "completed"` implies (1) the active subspec's non-human-only acceptance criteria are all ticked at the boundary, (2) a completion commit exists, (3) confirmed PR evidence (a pushed commit linked to an open PR), (4) the ready gate is green, and (5) if the active subspec's acceptance criteria reference `bun run test:integration:v2`, that command exits zero. Rows that exhausted the repair budget instead remain `failed` / `ready_gate_failed` / resumable and do not imply a green gate until a gate-only resume succeeds.

The spec.criteria-ticked contract prevents `done` / `no-work` completions when unticked non-human-only criteria exist, re-reading the subspec from the run's worktree and blocking before any completion commit or PR publication. The completion boundary enforces (2): when the committer returns no new commit and the worktree is dirty, the run records `completion_commit_failed` and names the uncommitted paths instead of masking them as `complete`. The publication boundary enforces (3): when the publisher returns a `pushSha` but no PR evidence (no `prNumber`), the run records `completion_commit_failed` (retryable) and skips ready finalization. A red gate demotes the run to `failed` and blocks completion; resume after fixing the gate. If (5) applies and the required integration test exits non-zero, finalization records `ready_gate_failed` with the command and output, blocks the draft-to-ready flip, and allows bounded repair. Until `implement-completion-requires-adversarial-mutation-verification` ships, mutation-review validation remains a stopgap in addition to explicit required integration scope.

**A `completed` implement row is not proof a run committed anything (2026-08-03).** Run `eabc39a7` settled `runStatus: "completed"` with `outcomeKind: "no-work"` and `iteration_commit skipReason: "no_file_changes"` — no commit, no push, no PR, no gate. It had executed in a pre-existing managed worktree (HEAD three commits behind the resolved `--base`, four modified tracked paths) which `resetStaleWorkspace` neither retired nor refused, and it read that dirty tree's already-ticked spec copy as truth. Confirm a `completed` implement row by its PR, not its status. Seed: `v2/spec/seeds/implement-completion-honesty.md`. Cleanup: delete this paragraph when that seed ships.

**Dirty `no-work` no longer settles `completed`.** A write step resolving `no-work` over uncommitted tracked paths settles `completion_commit_failed` (or an equivalent non-`completed` failure) naming those paths in durable `loop_finished` output — including workflow steps with `publishCompletion: false`. A `completed` implement row over a dirty tree is not trustworthy.

**Runtime smoke.** Inspect `jarvis run log <id>` for `runtime_smoke_outcome` after a successful completion. `observed-clean` records an executed smoke probe: the CLI help command succeeded, or the daemon lifecycle handshake (start → status → stop) succeeded with status reporting running state. `not-runnable` records every inspected production path and a non-empty discovery reason; it certifies discovery found no loadable CLI or daemon probe, not that runtime execution occurred. The handshake uses an isolated temporary daemon (not the operator's) and cleans up all IPC artifacts on all outcome paths.

Implement PR bodies carry an agent-authored review-altitude narrative in the PR marker block (see [PR body narrative markers](./workflow-runner.md#pr-body-narrative-markers)). The shrink pass authors this narrative after implementation; on re-publication, human edits inside the marker block are preserved and clobber-protected by precedence rules.

`jarvis1 run` must not report success when the ready gate is red (seed `run-cannot-report-complete-over-red-gate`). Treat `criteria-complete` exit 0 as insufficient without a green gate on the branch head.

### Mutation verification

**The contract.** Implement mutation evidence is diff-derived at two boundaries: in-loop on each implement `done`/`no-work` iteration before completion commit or publication (first discovery — live-agent `write.surviving-mutation-reprompt` while budget remains), and confirm-only at publication after the scoped ready gate passes (blocks repair-introduced survivors only; `write.mutation-repair` is the publication-time repair arm, not in-loop budget exhaustion).

**In-loop misses.** When in-loop verification finds an uncovered guard, the harness reprompts the live implement agent — it does not strand post-publication on first discovery. Reprompt budget exhaustion on the implement write row settles `surviving_mutation_failed` with `nextAction: "resume"` on that row. Direct `jarvis run start` pause/resume does not replay `surviving_mutation_reprompt` context (`reconstructDirectWriteResume` omits it, same as landing and staged-Markdown reprompts); workflow-snapshot implement runs restore it through `reconstructWriteResume`.

**Publication-time survivors.** A `surviving_mutation_failed` at publication after in-loop pass indicates a repair-introduced mutant (for example ready-gate repair edits), not a missed implement `done` check. Publication does not reprompt the implement agent or re-enter the implement write loop; recovery is review `write.mutation-repair` resume admission on the durable review row.

**Scope.** Mutation verification inspects production diff paths only; test-file changes (basename contains `.test.`) are not mutation candidates and will not surface `surviving_mutation_failed`. It requires expectations independent of the mutated production behavior; self-referential doubles invalidate that evidence. A `surviving_mutation_failed` outcome whose site is a timer callback in a determinism-guarded root (v2/src/daemon or v2/src/execution .test.ts) names both constraints: the natural kill test (forbidden by the determinism guard's real-timer prohibition) and the fix — extract the guard into a pure exported predicate and test both truth directions directly without a real-timer wait, then resume. Codify the extracted predicate in the guarded suite's test file and verify its coverage independently.

**Operational caveats.** Scoped verifier runs are bounded by `MAX_VERIFICATION_MS` and a concurrency cap; several surviving sites multiply publication wall clock. Same-file candidates run serially (mutate → scoped test → restore before the next candidate on that file); distinct production files may overlap. A pre-fix same-file concurrency bug could report `surviving_mutation_failed` at a changing site or for a mutation you can kill manually — see the flip-and-test check below.

**Flip-and-test false-positive check.** When `surviving_mutation_failed` names a site you believe is covered, manually apply the reported mutation at that exact source site (or flip the named guard), run only the resolved killing test(s) (co-located union plus any direct importers under the scan root), and compare the outcome. If the scoped test fails under your manual mutation, treat the harness report as a false positive (pre-fix same-file concurrency clobbering in-flight mutants, or a live-verification tree read during finalization — not merely "the tree looked broken while the verifier was running"). If the scoped test passes under the mutation, treat it as a genuine uncovered guard (or apply existing timer/dual-constraint runbook guidance when `dualConstraint` is set). When the failure is `importer-discovery-cap-exceeded` with co-located tests present, scoped execution was blocked by same-root `*.test.ts` sprawl — reduce sprawl under the scan root or add co-located killing coverage so discovery stays within the 200-candidate bound.

**Authoring guidance:**

- **Invert real guards in source tests during implementation** — production invert hooks are not evidence.
- **For a genuinely behavior-neutral mutation, restructure cheaply first** — only when a candidate is provably equivalent and irreducible, add an exact colocated directive on the mutated physical line: `// @mutate-equivalent mutation=<JSON string> reason=<JSON string>` with standard JSON escaping, `mutation` equal to the verifier-generated string, and a substantive decoded reason; never add a vacuous killing test.
- **Never `git checkout -- <file>` to undo a manual mutation test (2026-07-26)** — it reverts *all* uncommitted work in that file. Copy the file first (`cp path/to/file.ts "$TMPDIR/file.bak"`), mutate, run the test, restore from the copy, then `git status --short` to confirm your own edits survived.
- **Never run your own mutation-applying diff review (or hand-apply mutations) against a worktree whose publication/finalization successor is still live** — the harness verifier and your review race on the same source files, and either side's revert can clobber the other's in-flight mutation (observed 2026-08-07). Review the committed diff (`git show`, `git diff main..HEAD`) or a detached copy, or wait for quiescence first (see [Deciding a workflow is finished](#deciding-a-workflow-is-finished)).

### The ready gate

The v2 ready gate runs the `full` tier (`check`, `typecheck`, tests, `lint:md`) unconditionally, overriding any `JARVIS_READY_TIER` in the parent environment. The `lint:md` step covers all v2 markdown: `v2/docs/**/*.md` and `v2/spec/**/*.md`, subject to the shared ignores (`**/completed/**`, `**/verdict-*.md`), and enforces the `no-hard-wrap` custom rule on that corpus. Repair soft-wrapped prose with `bun run reflow:md` (same globs and ignores as `.markdownlint-cli2.jsonc`). The test step is base-scoped: a diff of `<baseRef>...HEAD` is classified via the shared classifier, and the resolved scope is passed as `JARVIS_READY_TEST_SCOPE` (e.g., `test:v2 test:integration:v2` when only v2 changed, or `full` for root tooling/shared changes). When the diff fails (unresolvable base ref), the test scope falls back to `full` and finalization proceeds — except no-test-impact diffs (`v1/spec/**`, `v2/spec/**`, `v1/docs/**`, `v2/docs/**`, `reports/**`, and intent `ready-intents/**`), which resolve to an empty test scope even then: `check`, `typecheck`, and `lint:md` still run, but no `bun run test*` steps execute.

**CI vs. the aggregate.** `bun run ready` runs the aggregate suite, which CI never runs (CI scopes by changed path via `scripts/ci-test-scope.ts`). Roster equivalence (aggregate = union of the scoped slices) and policy parity (per-file timeout floor — a permanent 180-second invariant in `scripts/run-v2-tests.ts` — isolation, failure handling) are protected by regression tests (`test/test-slices.test.ts`, `scripts/ci-test-scope.test.ts`), so green CI is evidence the local gate can pass. When a gate goes red on a diff that cannot explain it, check path classification first; if correct, the failure is environment-specific (machine load, system flake), not a code issue. See [`v1-behaviors.md`](./v1-behaviors.md) and [v1 runbook § The gate](../../v1/docs/operator-runbook.md#the-gate).

**Wall clock and load.** The full aggregate `bun run test` wall clock is ~326s (mean, measured 2026-07-26; down from 697s) because the runner executes independent test files concurrently — the gate deliberately saturates the machine by design. A scoped run executes a slice subset and runs faster. On an already-loaded operator machine, a gate failure is worth one re-run before trusting it; `JARVIS_TEST_CONCURRENCY` is the lever if load contention is the suspected cause (see [test-writing.md § Bounded concurrency pool](./test-writing.md#bounded-concurrency-pool)).

**Autofix, bounded repair, and settlement.** A red ready gate first runs project autofix once per repair entry (after the repair fence freezes, before any repair agent): configured `fixCommand` or built-in `bun run fix`, post-autofix `bun run typecheck` verification, fence-validated commit with `Jarvis-Ready-Gate: autofix`, republish, and re-gate — without charging repair iterations. When typecheck fails on autofix output, edits are reverted, `jarvis run log` records `ready_gate_autofix_discarded` (with `typecheckExitCode` and a bounded output tail), and bounded repair proceeds on the pre-autofix tree. Autofix failure settles retryable `completion_commit_failed` without agent repair; a still-red gate after successful autofix enters up to three bounded repair iterations (each consumes the iteration budget and republishes before the gate reruns). When every non-timeout repair attempt stays red, the run settles `failed` with `ready_gate_failed`, `resumable: true`, and `loop_finished` evidence `readyGateOrigin: repair_budget_exhausted` plus `readyGateRepairCount: 3`; that row retains its publication checkpoint and admits `jarvis run resume` on a gate-only finalization tail — no write-agent re-entry. Other `ready_gate_failed` rows (blocked repair, iteration-limit suppression, deadline timeout, missing/mismatched checkpoint) keep their existing resume paths or refusals. A deadline-killed gate (exit code 124 or `ready: deadline exceeded after Nms …`) skips repair, logs `ready_gate_timeout`, and settles for `jarvis run resume` — a budget kill, not a red gate: the gate passed locally and timed out against a per-step budget or the run ceiling (see [test-writing.md § Ready-gate step budgets](./test-writing.md#ready-gate-step-budgets); `shared/**` changes can hit this from running all three test slices). Per-step budgets are fixed constants in `scripts/ready.ts`, so a step-budget kill needs that constant raised, not a resume; resume only helps when the run ceiling (`JARVIS_READY_TIMEOUT_MS`) bound. Flip failures are not repaired; resume a `ready_gate_failed` or `surviving_mutation_failed` run after fixing coverage. For `ready_flip_failed`, manually fix the PR draft → ready transition (see [Publication / completion failures](#publication--completion-failures)); do not `jarvis run resume`. Review every repair commit's file list before merging.

**Out-of-scope failures.** When every attributable failing path lies outside the run's touched set (spec tree plus base-to-HEAD diff and untracked inventory) and also reproduces on `baseRef`, finalization settles `ready_gate_out_of_scope` instead of entering bounded repair. `list` / `wait` name `error.reason: ready_gate_out_of_scope`, preserve `error.readyGateOutsidePaths` and `error.readyGateOutOfScopeDetail`, and report `nextAction: stop` when the outside-path set is unchanged from the row's first such settlement — resume cannot clear that condition. Do not `jarvis run resume` or repair unrelated source files for unchanged-path out-of-scope failures.

**Missing gate command.** When gate output names a missing spawn target (`Script not found`, `command not found`, or `ENOENT`), finalization settles `ready_gate_command_missing` instead of entering autofix or repair. Read `error.message` for the configured command and bounded output, fix `projects.<key>.readyCommand` or add the missing script, then re-dispatch. `nextAction` is `fix_config`; `jarvis run resume` is refused because resume cannot create the command.

**Agent-written cognitive complexity: three enforcement boundaries (2026-08-31).** (1) **Durability checkpoints** (`commitSettledIteration` / controlled-loss quiescence): best-effort scoped `biome format --write` on enumerated changed paths; commit on file changes without lint/format gating — complexity lint at the checkpoint seam no longer strands work or settles `iteration_commit_failed`. (2) **Terminal completion and ready-gate repair re-commits** (strict `formatMode` publication boundaries): best-effort scoped `biome check --write` on enumerated changed paths — applies every safe fix, then commits the tree as-is even when a non-autofixable finding (`noExcessiveCognitiveComplexity`, max 24; `noNonNullAssertion`) remains. A durability commit is never gated by lint, so the completion commit no longer strands `completion_commit_failed` on lint (a genuine `biome` timeout still fails); lint is enforced downstream at (3). These boundaries still append a commit only when they introduce file changes not already on `HEAD`. (3) **Ready gate and CI**: complexity enforcement remains; `bun run fix` / `check:fix:unsafe` cannot repair cognitive complexity. The implement write-step rules now instruct the agent to keep new functions under the limit or add the `// biome-ignore` itself. Recovery when the **ready gate** (no longer the completion commit) fails on complexity: add a `// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: <reason>` above the function (or extract helpers preserving guard text so `@mutate` pins still match), then resume the gate tail.

v2 TUI tests can pass while ink rendering is broken when assertions only walk production monitor state or the injected input hook without inspecting the ink element tree — prefer region-local ink tree walks via `createMonitorDisplay`; see [`test-writing.md` § TUI test strategy](./test-writing.md#tui-test-strategy).

## Recovery

Documented gaps and operator workarounds. Remove entries when seeds merge.

### `iteration_timeout` with completed subspecs

When a write step times out after at least one linked subspec's non-human-only acceptance criteria are fully ticked, the run settles `iteration_timeout` with `resumable: true` and terminal `loop_finished` lists `completedSubspecPaths` / `remainingSubspecPaths`. Recovery is `jarvis run resume` on the retained workspace — not `resetStaleWorkspace`, not a full workflow re-dispatch. A timeout with no completed subspec stays non-resumable; re-dispatch the workflow after inspecting the stall in `jarvis run log`.

### `idle_output_timeout` with committed checkpoint

When a write-step inactivity stall settles `idle_output_timeout` after the boundary checkpoint produced a fresh `iteration_commit` `commitSha`, terminal `loop_finished.resumable: true` projects `error.nextAction: "resume"`. Agent output and debounced non-sidecar file activity under the invocation `cwd` both re-arm this watchdog; harness metadata sidecar writes (any `.jarvis-*` path segment except workflow staging directories `.jarvis-plan-stage/` and `.jarvis-intent-stage/`, plus `verdict-*.md` basenames) do not. Recovery is `jarvis run resume` on the retained branch and worktree — not `resetStaleWorkspace`, not a full workflow re-dispatch. A stall with no checkpoint commit (`resumable: false`) stays `nextAction: "stop"`; re-dispatch the workflow after inspecting `jarvis run log`. Write-path stalls open a per-iteration session log; pre-stall streamed output is preserved as combined stderr-then-stdout under `inbound_stderr` only — empty stalled inbound means real silence, not discarded stdout.

### Salvaging a stranded implement run

Implement can wrongly settle `completed`/`no-work` after finishing only one subspec of a multi-subspec tree (no PR published), or settle `failed`/`blocked` with the work substantially done. Don't default to a re-run — it spends another full iteration budget and may strand the same way. Diagnose, then salvage:

1. **Diagnose from the worktree, not the row.** Count per-subspec AC ticks (`sed -n '/## Acceptance criteria/,/## Documentation/p' <sub>.md | grep -c '\[x\]'`) and read `git diff --stat main`. A `completed` row on a multi-subspec spec proves nothing about subspecs 01+.
2. **Cost the hand-finish before re-running.** Check the branch against each acceptance criterion and lay out what finishing takes; re-run only when the work is genuinely incomplete or the merge is a semantic conflict of two rewrites.
3. **Run the real gates in the worktree:** `bun run typecheck`, `bun run check`, `bun run lint:md`, and the affected test files (in isolation when the machine is loaded — concurrent load flakes timing-bound tests that pass alone). `bun test` does not typecheck; tests-plus-typecheck alone is not the gate.
4. **The harness verifiers are hand-callable — a hand-finish forfeits nothing.** `verifyDiffDerivedMutations` (`v2/src/execution/diff-derived-mutation-verifier.ts`) and `verifyRuntimeSmoke` (`v2/src/execution/runtime-smoke-verifier.ts`) are exported functions taking `{worktreePath, runBase}`; a ~10-line script drives both. Nothing forces you to run them, so make them part of every hand-finish.
5. **Finish:** tick the ACs with a real editor (stream edits can eat adjacent headings), add missing `## Documentation updates` work, review the full production diff AC-by-AC, commit, push, PR, merge after green CI — then do the spec bookkeeping ([Hand-publish leaves spec bookkeeping behind](#hand-publish-leaves-spec-bookkeeping-behind)).

Before touching the worktree at all, confirm no successor run still owns it (see [Deciding a workflow is finished](#deciding-a-workflow-is-finished) — the publication row dispatches late).

### Stale `origin/<branch>` after hand-merge

Hand-pushed or hand-merged run branches often leave `refs/remotes/origin/<branch>` on disk after GitHub deletes the remote head. Incomplete git-enabled `implement` or `plan` re-runs (`resetStaleWorkspace` preflight) prune that remote-tracking ref during retirement and print `Pruned stale remote-tracking ref: origin/<branch>` on success stdout. `jarvis cleanup --abandon` uses the same retirement sequence.

### Hand-publish leaves spec bookkeeping behind

The harness ticks acceptance-criteria and index checkboxes as part of its own landing; a hand-published or hand-merged implement PR skips that, so the spec on `main` keeps unticked boxes even though the work landed (observed 2026-08-28: #2959 merged with all 16 ACs unticked; #2977 and #2998/#2999 with index boxes unticked). Every such spec then surfaces in `jarvis cleanup` as a stranded artifact with an unchecked criterion and is never archived. When hand-publishing, finish the bookkeeping in the same sitting: verify each AC's named artifact actually exists on `main` (tests by literal title, doc updates by content — never tick by name-match), tick the AC and index boxes, and archive the spec dir to `completed/` in the merge or a follow-up commit. Re-runs already tolerate a lagging index box (subspec routing keys off unticked criteria, not the index), so the cost of skipping this is borne by cleanup and future operators.

### Intent finalization failed with staged files remaining

A reviewed intent workflow can fail after critic/actuator succeed but landing (promotion, commit, push, or PR) fails, leaving `.jarvis-intent-stage/` still populated. `jarvis run list` / `jarvis run wait <id>` show `landing_failed` (`nextAction: "resume"`).

**Write row** (`runId` on the intent-split write step) settled `landing_failed` means the reprompt budget was already spent — hand-edit `.jarvis-intent-stage/`, then resume the **write step's** `runId` (the split row from `jarvis run list`, not the review row):

```sh
jarvis run list              # find the failed write-step row (intent-split / split)
jarvis run resume <runId>    # write-step runId — re-enters the write loop
```

`reconstructWriteResume` preserves stage bytes and restores pending landing-contract, staged-Markdown-lint, or surviving-mutation reprompt context from the last matching log event (including after pause on workflow-snapshot runs). Direct `jarvis run start` resume omits all three reprompt replays. Historical checkpoint reprompt log tails remain tail-readable but do not restore reprompt context or checkpoint-derived iteration accounting on resume — restart the run or hand-repair.

**Review row** (`runId` on the review/finalization step) settled `landing_failed` with populated stage replays finalization only (`resolveIntentFinalizationResumeContext`), not the write loop:

```sh
jarvis run resume <runId>   # the review step's runId from `run list`/`run wait`
```

This replays only finalization — promoting `durableDir`, deleting the stage and verdict sidecars, committing, pushing, and opening/reusing the draft PR — from the persisted workflow snapshot. It never re-invokes split, critic, or actuator. `jarvis run wait <runId>` reports `completed` on success.

When `landing_failed` follows review-path staged-Markdown lint budget exhaustion (`staged_markdown_lint_reprompt` events in `jarvis run log`), hand-edit the violating file under `.jarvis-intent-stage/` or `.jarvis-plan-stage/`, then resume the review row. Checkpoint re-entry (`finishReviewedLanding`) may reprompt the actuator while lint-reprompt budget remains; when exhausted, intent populated-stage resume (`resumePopulatedIntentPublication`) re-lints only — fix violations on disk first, then `jarvis run resume` — it never re-invokes critic or actuator.

Prerequisites: the failure must be git-enabled (git-disabled runs have nothing to commit/push) and the stage must still hold files — an empty/missing stage reports `unsupported_resume_context` and needs manual inspection.

### Workflow ends "complete" but produced no PR

A workflow can die after its step runs settle (review step, publication) — step rows then all read `completed` while nothing was committed, pushed, or published. Diagnose with:

- `~/.jarvis/daemon.log` — `Workflow execution failed (<workflow>): <message>`
- `jarvis run log <id>` — trailing `run_execution_failed` record with the message
- `jarvis run wait <entry-id>` — reports `harness_failure` instead of a clean complete
- `~/.jarvis/telemetry.jsonl` — per-role rows show which review roles actually ran; **filter by `run_id`, do not read the tail and assume** (see [Reading telemetry](#reading-telemetry))

Plan debate review has its own durable `run list` and TUI row, identified by the authored workflow `stepId` alongside the plan draft row. During execution its workflow detail shows the active adversary, advocate, adjudicator, or actuator; after completion, failure, interruption, or daemon restart the retained row shows its terminal status. Telemetry remains the per-role audit trail.

### Reading telemetry

`~/.jarvis/telemetry.jsonl` is the per-role audit trail: one JSON row per role invocation. Rows are **snake_case** and carry full attribution plus cost:

```text
run_id  branch  project  step_id  attempt_id  invocation_id  workflow  spec_ref  worktree_path
role  agent  model  binding_id  binding_index  duration_ms  exit_kind  exit_reason
cost_usd  cost_source  usage  usage_source  ts  operator_session_id  record_kind  schema_version
```

Filter by `run_id`. Do **not** read the tail and attribute by recency — with two lanes running, rows from different runs interleave:

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

**Gotcha (2026-07-26): the keys are `run_id`, not `runId`.** Querying `runId` returns `None` on every row, which reads exactly like "telemetry has no run attribution" and invites recency-guessing. Print `sorted(d.keys())` on one row before concluding a field is absent.

`cost_usd` is per-invocation agent cost, so agent-side spend is queryable per run and per spec — metered agents record billed or list-price dollars; codex and cursor rows carry list-price `cost_usd` when usage and a priced `priceKey` settle (`cost_source: "computed"`). Codex `no-usage` means correlation missed, every matched `token_count` had `info: null`, or usage shape was unextractable; `no-price` means usage was mapped but the binding's `priceKey` is absent from `data/prices.json` or catalog load failed; `unavailable` on usage means no agent-reported counters were settled. Pre-computed cursor rows lack comparable `cost_usd`. That is the source for the agent-cost column in a session report; the operator's own `/cost` is separate.

### Workflow reports a stale worktree claim

Distinguish five cases:

1. **Pre-mutation claim refusal** — incomplete implement/plan re-run refused before stale retirement with `worktree_claimed:` (not the `Cannot re-run incomplete spec:` wrapper). Worktree, branches, remote, and PR are untouched. Wait for the owning run to finish or release the key, then re-run.
2. **Pre-mutation claim-check failure** — daemon claim probe missing or RPC error; refused with `Cannot re-run incomplete spec:` (not `worktree_claimed:`). No retirement. Restore daemon IPC and retry.
3. **Post-retirement `start` failure** — retirement already ran, then `start` returned `worktree_claimed`. This is the bug class pre-mutation claim gating prevents; if you still see it on an older build, inspect partial teardown before re-invoking.
4. **Claim acquired after retirement but before `start`** — another dispatcher claimed the key in the gap; artifacts may already be gone. Finish any partial teardown by hand before re-running.
5. **Partial teardown already happened** — use the `Retirement destroyed artifacts:` summary and [`--abandon`](#v2-debris-blocks-the-jarvis1-fallback) remnants table; re-invoke is not always safe.

The pre-mutation client probe uses the same admission predicate as workflow `start` (queued rows and registry claims, not `list` `isLive` alone). Stale in-memory workflow claims that `start` would reclaim at admission match the probe too — retirement may proceed when post-reclaim admission would succeed. The probe still refuses before retirement when `start` would refuse without reclaim (queued rows or a live registry-held claim), which prevents destruction.

If a workflow start returns `worktree_claimed` after its prior owner is no longer live and retirement did not run, invoke the workflow again. The daemon drops that in-memory workflow claim at admission and preserves all worktree and branch state; do not restart the daemon or remove a worktree for this case. A genuinely live owner remains protected and continues to reject the same `(project, branch)`.

### v2 debris blocks the `jarvis1` fallback

A failed v2 run leaks its worktree under `~/.jarvis/worktrees/<project>/<branch>/` and holds the branch name. `jarvis1 plan`/`run` for the same name then dies with `fatal: '<branch>' is already used by worktree at …`, so **the v2 failure breaks the v1 recovery path**. Clear it before falling back:

```sh
git worktree remove --force ~/.jarvis/worktrees/<project>/<branch>
git branch -D <branch>
git worktree prune
```

**Release the daemon claim before git-level removal.** Removing a worktree while the daemon still holds its `(project, branch)` claim leaves the next run refusing `process <pid> holds worktree lock`; recovery is then `rm -rf` the husk plus `git worktree prune`. Prefer `jarvis cleanup --abandon <name>` (it refuses while a live run or `.jarvis.lock` holds the tree); use the git-level recipe only when no live run owns the worktree.

This is the **unmerged/failed** case; `jarvis cleanup` only retires *merged* workspaces, so it will not clear this debris. Use `jarvis cleanup --abandon <name>` to retire one named wedged workspace:

```sh
jarvis cleanup --abandon <name> --dry-run   # preview without confirmation
jarvis cleanup --abandon <name>             # preview + [y/N] confirm
jarvis cleanup --yes --abandon <name>       # agent/scripted removal (no TTY prompt; without --yes, non-interactive stdin assumes no)
```

`--abandon <name>` resolves the workspace name to its branch, worktree path, and matching open PR. It previews the planned actions in order (remove worktree, delete local branch, delete remote branch, prune stale remote-tracking ref when present, close PR), prompts for confirmation, then executes them sequentially. Remote deletion is a no-op success when the branch was never pushed or the repo has no `origin`; a real remote failure (auth, network, protected ref) aborts. Successful retirement stdout names each step. If any step fails, the operation stops immediately and exits nonzero. It leaves source spec files and durable run rows intact. It refuses before touching anything if the worktree is missing or held by a live run (daemon `isLive` or locked by `.jarvis.lock`).

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

**Guard order after a rebuild (2026-07-30):** retiring a wedged workspace after the executable was rebuilt hits two guards in sequence — `Cannot abandon: no daemon is listening` (the digest-keyed socket moved; fix with `jarvis daemon start`) and then `Cannot abandon: matching PR is ready (non-draft)` (fix with `gh pr close <n>`, or mark it draft again). Both are the guards working; the order is not obvious from the messages.

### Blocked run: inspect and resume

A `blocked` run (agent appended `## Blocker` to the spec) keeps its worktree, branch, and `git worktree list` registration. `jarvis run list` and `jarvis run wait <run-id>` report `worktreePath` for blocked rows; inspect the spec and uncommitted work there and resolve the blocker.

**`jarvis run resume` does not work on a blocked run** — it refuses with `terminal_run` and names spec inspection / re-run recovery, and `run list` correctly reports the row as `resumable: false` with remediation `inspect_spec`. To continue the work, resolve the blocker and **re-run the spec** (an incomplete re-run resets the stale worktree from `--base` — see [Incomplete re-run preflight gates](#incomplete-re-run-preflight-gates)). Uncommitted work in a prior worktree is not carried forward.

When an agent emits a `blocked` token without appending a `## Blocker` section, the harness reprompts for blocker text. If the agent still fails to provide it, the run reports as `missing_blocker` harness defect (`error.reason: "missing_blocker"`, `error.retryable: true`, `error.nextAction: "resume"`), not bare `agent_blocked`. Applies to both the write (run/plan) path and the implement workflow path.

**`missing_blocker` can fire when the agent did append a blocker (2026-07-26):** run `4bfca748` settled `missing_blocker` while `## Blocker` sat at line 93 of the active subspec with accurate content — the run had 0 commits and 4 dirty files, so the blocker text existed only in the uncommitted worktree. Read the subspec in the worktree before treating `missing_blocker` as agent misbehavior.

**Blocker text persistence:** when a `blocked` outcome satisfies the contract, the agent's blocker body is persisted as a durable `blocker_text_detail` log record (truncated to 500 characters), retrievable via `jarvis run log <run-id>` without the worktree spec file: `jarvis run log <run-id> | grep blocker_text_detail`.

### Orphaned non-terminal runs after daemon restart

**A daemon restart does not orphan in-flight work** (corrected 2026-07-25; reconcile-and-resume shipped in #1430, #1476–#1478). Durable non-terminal rows from a prior daemon are reconciled to `killed` with reason `daemon_restart` before IPC opens. Once IPC is healthy, the daemon automatically resumes every reconciled row with a resolvable workflow write snapshot. The original run ID, snapshot, worktree, and branch are retained; check `jarvis run log <run-id>` for its `run_recovery` outcome. A failed automatic admission becomes `failed` with an actionable log diagnostic, without blocking other recoveries. Committed iteration SHAs on the same branch survive kill, reconcile, and resume while the branch exists; only in-flight edits before that iteration's git commit may be lost.

The exception is narrow: a reconciled orphan with a **missing or unresolvable workflow write snapshot** is not auto-resumed. It stays `killed`; `list` / `wait` report `unsupported_resume_context` with `retryable: false` and `nextAction: "stop"`. Fix the persisted context or re-run the spec rather than treating that row as a config-binding failure. Review-step rows are exactly that shape, so a restart while a review step is live will strand that row; a restart during a write step will not (observed 2026-07-25: four `unsupported_resume_context` rows in one session, all review steps — and none actually caused by a restart).

**Per-iteration commits cover every settled result (fixed 2026-07-27).** Every git-backed write loop checkpoints before the SQLite boundary of *every* settled main-loop iteration — `progress`, `complete` (`done`/`no-work`), `blocked`, `contract_miss`, `invalid_token`, `missing_blocker`, `invocation_failure`, and `stall`/`idle_output_timeout` — so a single-iteration `done` run emits an `iteration_commit` before `boundary_committed` and a kill or crash after the checkpoint retains that iteration's edits. Controlled losses (a `jarvis run kill`, a plain `args.signal` abort, or an iteration watchdog firing mid-invocation) also checkpoint: the loop waits (bounded, 30s default `quiescenceTimeoutMs`) for the raced-away invocation to quiesce and, if it settled with a real step result, checkpoints it before declaring the loss. A kill acknowledgement (the RPC response) only records the kill; full durability is guaranteed only once the write loop itself settles — `run wait`/`run log` are the proof, not `run kill` returning success. If a checkpoint after a kill fails, the recorded `killed` status is authoritative and not clobbered. Ready-gate repair iterations are excluded from this floor (they keep their prior publish/recommit behavior), and abrupt daemon/process death remains outside the guarantee. See `v2/docs/write-behavior.md` § Per-iteration commits for the full contract. **Implement re-run reset** (`resetStaleWorkspace`) still drops the branch and unpushed commits; publication remains terminal-`complete` only.

### Wedged pipeline-stage settlement after daemon death

Canonical contract (deferred marker vs no-marker shapes, restart vs live-daemon resume, PR-evidence preservation): [`pipeline-execution.md` § Operator recovery](./pipeline-execution.md#operator-recovery) and [Merge-day settlement](./pipeline-execution.md#merge-day-settlement).

A pipeline stage can wedge `running` with `failureDetail: { code: "settlement_deferred", reason: "entry_run_still_live" }` when a prior daemon dies between its entry run reaching a durable terminal status and that status being delivered back to the stage row. The same stuck shape can appear without that marker when out-of-band settlement never ran — commonly `dispatchPipelineStage`'s catch path returning while the admitted entry run was still live — leaving `running` with `workflowInvocationId` set and no `failureDetail` even though the linked entry run's durable sibling rows already roll up to terminally `failed` (quota exhaustion and other invocation failures included). Neither wedge strands the pipeline permanently: both settle `failed` and admit `jarvis pipeline resume` once the linked entry run is durably terminal.

The **first** daemon restart after the wedge recovers it automatically — the startup continuation sweep (`continueContinuablePipelines`) advances or fails the stage from its entry run's durable rows and dispatches the pending successor or terminal publication, provided that entry run is already durably terminal and was not itself reconciled by that same restart (see [`daemon-host.md` § Restart reconciliation and recovery](./daemon-host.md#restart-reconciliation-and-recovery)). A genuinely live entry run, or one reconciled by that same restart, is left alone; if it later settles `interrupted` the usual way, it is out of the re-drive's reach on any later restart.

On an already-up daemon, `jarvis pipeline resume <pipeline-id>` (no branch key) admits the same re-drive without a restart — same terminality requirement; a genuinely live entry run still refuses `pipeline_not_resumable`. For the no-marker rollup-`failed` wedge on a live daemon, expect **two** unscoped resumes: the first settles the stage `failed` (the pipeline derives `failed`), the second reopens and redispatches; after a daemon restart the continuation sweep settles first, so one resume suffices. Exit `0` still means admitted, not settled — confirm via `pipeline list` / `pipeline wait`; a durably-failed entry run settles the stage `failed`, not `succeeded`.

When re-settlement succeeds, `pipeline resume` reloads the linked entry run and preserves its published `prNumber`/`prUrl` in the stage artifact, allowing terminal `ready`/`merge` to land. If completion publication left the final workflow entry run without a complete pair, the stage instead fails with `completion_publication_missing_pr_evidence` and terminal publication is not invoked. This extends [pipeline-resume-drives-deferred-settlement](../spec/completed/20260825T232845Z-pipeline-resume-drives-deferred-settlement/index.md).

### Clearing a stale non-active run with `run kill --force`

Reach for `jarvis run kill --force <run-id>` only after `run resume <run-id>` refuses (`unsupported_resume_context` or similar), or the row has no resumable write context at all — a stale `paused` row is the common case, since `paused` is not boundary-terminal and never ages out of the default retention window on its own. Do **not** force a row whose owning daemon is mid-`finalization` or mid-`recovery`: the force path only takes the safe abort branch for a live `write-loop`/`workflow` active kind (see the `kill` RPC row in [`daemon-host.md`](./daemon-host.md#rpc-methods-transport-slice)); forcing a mid-finalization or mid-recovery row stamps it `killed` while that work keeps running underneath.

`--force` settles the durable row `killed` with a finish timestamp — it does not delete the row. A force-settled workflow step stays listed until every non-terminal sibling under its `invocationId` is also settled, so clearing a stale workflow means forcing each non-terminal sibling, not just the one row you noticed.

`run kill` does not auto-start the daemon (unlike `run resume`): a stale row plus a stopped daemon yields a connection error, not a kill. After a daemon restart, a stale row's owner is a dead prior incarnation — run reconciliation settles that on its own (see [Orphaned non-terminal runs after daemon restart](#orphaned-non-terminal-runs-after-daemon-restart)); a forced kill isn't needed there.

This clears the run row only. Pipeline/stage display rows are a separate concern — see [Pipeline dismiss and undismiss](#pipeline-dismiss-and-undismiss).

### Wedged run, no agent activity

Check `~/.jarvis/daemon.log` and `jarvis run log <run-id>`. Plan draft stalls historically threw before agent invoke (fixed in shipped PRs); similar failures may still exit without `iteration_started` follow-up until `write-loop-iteration-timeout-on-stall` lands.

### Stopping a live workflow implement run

`jarvis run kill <run-id>` (or `k` in `jarvis tui`) aborts a live workflow-started write step and records durable `killed`; `pause` / `resume` still refuse workflow rows ([`daemon-host.md` § Live controls](./daemon-host.md#live-controls-on-workflow-started-runs)). A daemon restart does not orphan in-flight work — see [Orphaned non-terminal runs after daemon restart](#orphaned-non-terminal-runs-after-daemon-restart) (including the review-step stranding exception).

### Branch / worktree collision

```
fatal: '<branch>' is already used by worktree at ...
```

Remove the stale worktree under `~/.jarvis/worktrees/…` and delete the local branch if safe. (`jarvis cleanup` handles this automatically once the branch's PR is merged; hand-remove only for unmerged branches — see [`--abandon`](#v2-debris-blocks-the-jarvis1-fallback).)

### Publication / completion failures

Retryable `completion_commit_failed`, `iteration_commit_failed`, `ready_gate_failed`, or `landing_failed` on `list` / `wait`: inspect `error.publicationFailure` first for publication failures, `error.completionCommitError` (trailing `run list` column or `error` on `run wait` stdout; full context on `jarvis run log`) for completion-commit failures; then verify the completion commit/PR state, fix `git`/`gh`/`origin` access, publication target state, or test coverage, then `jarvis run resume <run-id>`. For `surviving_mutation_failed`, inspect `error.survivingMutation` and source file/line, fix coverage, then resume the row that discovered the survivor: in-loop budget exhaustion on the implement write row resumes that row agent-free; publication-time repair-introduced survivors resume the durable review row via `write.mutation-repair` (see Surviving mutation failures below), not implement write-loop re-entry. For `iteration_commit_failed`, the failing iteration never reached `boundary_committed`; resume retries that iteration (including its git commit) without advancing the loop. For a post-commit shrink `contract_miss` on `implement~shrink`, read `contract_miss_detail` on that row's log, then `jarvis run resume` on the `~shrink` row (not `inspect_spec` on the workflow entry). For an attached workflow whose entry reports a hidden shrink mutation failure, find and resume the owning `~shrink` row in `jarvis run list`, not the printed entry ID. When the owning row is instead a durable review-behavior step (e.g. `implement-review`, or a durable `review-debate` last step), resume that row's own id — the durable write step already committed, so resume replays only mutation re-verification, the ready gate, and publication, never a write-loop re-entry. Resuming the workflow entry id or a completed `~shrink` row for that scenario still refuses. Resume reuses the persisted write snapshot for step identity (rules, artifact path, outer agent order) before replaying publication without re-invoking the write-step agent; agent/model bindings come from the current machine profile at continuation time. Confirm the active rung from attempt telemetry until `jarvis run list` shows binding. Daemon-process logs are secondary for `iteration_commit_failed`, `ready_gate_failed`, `landing_failed`, and `surviving_mutation_failed`; for `completion_commit_failed`, rely on `error.completionCommitError` instead. Do not delete the worktree.

For a red pipeline stage or `ready_gate_failed` run, read `failureDetail.message` or `error.message` first: current rows name the resolved gate command and include the last 4096 characters of trimmed combined output. Open the full run log only when that bounded diagnostic is insufficient; legacy rows may have no message.

**Store lock after a completed write step:** when `list` / `wait` report `error.reason: "state_store_lock_timeout"` (`retryable: true`, `nextAction: "resume"`) after the write loop already committed its `done` boundary, run `jarvis run resume <run-id>`. The finished write step is not re-run; resume continues from the persisted checkpoint. This differs from generic `harness_failure` on message-less `run_execution_failed` records.

**`ready_flip_failed` is terminal** — do not resume. The flip error identifies the PR by number (`error.prNumber`, also `readyFlipPrNumber` on `jarvis run list <run-id>`); manually fix the PR draft → ready transition (no daemon restart or `jarvis run resume` needed), verify `gh pr view <prNumber> --json isDraft` reports `false`, then proceed.

**Surviving mutation failures are failed and resumable (2026-07-21; sibling lookup fixed 2026-07-27).** A run ending `loopOutcomeKind: "surviving_mutation_failed"` settles `failed` on `run list` / `run wait` with `error.reason: "surviving_mutation_failed"`, `retryable: true`, `nextAction: "resume"`, and the surviving mutation text plus source file and line. Recovery path depends on where the survivor was discovered: in-loop budget exhaustion on the implement write row resumes that row with agent-free `jarvis run resume` after fixing coverage; publication-time repair-introduced survivors resume through review `write.mutation-repair` on the durable review row (see eligible owning rows below). During the post-completion verification tail the durable row is `in-progress`, not `completed`.

- **Eligible owning rows:** a failed durable `review-debate` row (including an implement workflow's debate `implement-review`) or a failed durable landing-bearing `review` row. A non-durable light `implement-review` sharing that step ID is never a recovery target. The workflow entry ID and a completed hidden `~shrink` row always refuse — only the review-behavior row itself is eligible.
- **Sibling resolution:** the durable write step's completed row is resolved by workflow `invocationId`, matching either the authored write stepId or a completed `<stepId>~link-N` row (the shape a linked-implement workflow's terminal pass persists). `run resume`, direct-row `run list`, and direct-row `run wait` all route through the same admission resolver; a stale pre-fix `loop_finished` record claiming `resumable: true` is projected `resumable: false` / `unsupported_resume_context` if current reconstruction can't resolve the sibling. Conflicting fields recorded on the review row itself never override the selected write row's own values.
- **Admitted outcomes:** `surviving_mutation_failed`, plus the `completion_commit_failed` / `ready_gate_failed` this same resume tail can itself settle. `runtime_smoke_failed` is excluded (retrying this tail cannot change a runtime-smoke result), along with `landing_failed`, `ready_flip_failed`, generic invocation failures, and completed rows.
- **Ticked mutation failures recover through implement.** If the agent ticked every acceptance criterion before the mutation failure, rerun `jarvis run workflow implement --base <ref> --spec <path>` with the same branch and spec: it finds the newest matching failed mutation-finalization row and retries that tail (mutation re-verification, gate repair, publication) without unticking criteria or replaying the write step. **Commit first:** mutation verification and body-summary derivation are diff-derived against the base ref; fix coverage in the worktree and let `run resume` commit it (or `git commit` it yourself) — an uncommitted fix either gets committed by the resume tail or settles a named `completion_commit_failed`, never silently re-verified against the stale diff. `implement.recovery_target_missing` means the retained worktree or branch was cleaned up; `worktree_claimed` means another live run owns it. Both refuse without changing the workspace.

`surviving_mutation_failed` → `jarvis run resume` applies before implement recovery exhausts its bounded repair attempts. `mutation_repair_exhausted` is not admitted again: manually fix and publish the retained worktree, or untick criteria before a fresh implement run.

**A `completed` implement whose final boundary itself made no change still publishes when its branch carries real content ahead of base (2026-08-26).** The completion tail's forced marker commit is gated on that commit's diff against `baseRef`, and the gate only suppresses publication when that diff was positively read and came back empty; an unresolvable `baseRef` or unreadable diff falls through to publish. A no-work shrink over an already-clean branch (no content ahead of base) is rolled back locally and never pushed — unless the boundary's commit carries real changes against its own parent (a legitimate revert of branch content back to base), in which case the commit stays local and unpushed rather than being unwound. A no-work shrink over a branch that already has real commits still publishes normally. For a historically stranded run from before this fix (an empty marker commit sitting unpublished), hand-publish from the worktree: `git push origin HEAD:<branch>` then `gh pr create --draft --base <base>`.

**Pipeline consequence:** a pipeline implement stage whose branch has nothing ahead of base settles `complete` with no draft PR at all (rather than an empty one). Terminal publication for that stage then fails fast with `TerminalPublicationError`'s "PR evidence required: prNumber and prUrl must be present" instead of ready-flipping an empty PR. Accepted: a stage with nothing to publish has nothing for a later stage to build on either.

### Intent-reviewed operator checkout

Review and landing must use the split external worktree, not the operator checkout. If review dirties the primary checkout, treat as a harness bug; seed `intent-reviewed-uses-external-worktree` (fold into `workflow-composable-collapse`).

### Daemon blocked on long git / ready subprocess

Responsive-daemon specs and seed `nonblocking-ready-gate-and-guard` address sync subprocess on the daemon event loop. Symptom: `jarvis run list` hangs while a run finalizes. Check for `bun run ready` or `git` children on the daemon PID.

## Cleanup: eligibility gate

`jarvis cleanup [<project>]` runs four independent slices in one invocation: merged-worktree retirement, worktree-independent merged-branch ref pruning, stranded open-home spec archival, and dead daemon-socket reaping. A named project scopes the first three project-owned slices through one filtered registry; dead daemon-socket discovery and reaping remain global because sockets are not project-owned. Bare cleanup intentionally scopes the project-owned slices to every registered project. An unknown project is refused before daemon discovery or cleanup survey. The positional project and `--abandon <name>` are mutually exclusive. Each slice previews in `--dry-run`, shares the apply confirmation prompt (`[y/N]`; `--yes` for scripted apply), and continues after partial failure in another slice unless noted below. `jarvis1 cleanup` remains blind to the v2 home; use `jarvis cleanup`.

**Local-only ref scope.** Bulk cleanup never deletes a branch on the remote repository. It may delete exact local refs only: `refs/heads/<branch>` and, when present, exact `refs/remotes/origin/<branch>`. `--abandon` is the path that deletes the remote branch.

### Merged-worktree retirement

`jarvis cleanup <project>` retires merged v2 worktrees discovered under `~/.jarvis/worktrees/<project>/`; use bare `jarvis cleanup` only to survey every registered project. The eligibility gate decides whether a worktree is safe to remove.

After Git retires a workspace, cleanup resolves its durable workflow or ad-hoc spec identity and archives an eligible completed artifact to `completed/` in the same cleanup invocation; this path needs no rerun. It prunes `ready-intents/<spec-name>.md` only when it byte-matches `intent.md`. `--dry-run` lists the worktree, archive destination, and that proven prune without changing worktrees, branches, specs, intents, or run rows. A failed retirement does not inspect or move its artifact. If archival is refused (incomplete criteria, an open matching PR, or another materialized owner), retirement remains successful and stdout names the artifact and refusal; resolve that condition, then rerun cleanup.

Cleanup also scans immediate open directories in every registered `v2/spec/` home, even when no workspace is retired. It ignores `completed/`, `seeds/`, and `ready-intents/`. The same completeness, open-PR, ownership, intent-proof, and move/rollback checks apply; stdout (including `--dry-run`) names candidates and refusals. It never changes durable run rows. A stranded spec is owned only by a discovered managed worktree in the same registered project on its recorded implementation branch; primary checkouts and other resolved branches do not own it. Cleanup rechecks ownership immediately before archival, and refuses archival when a same-project managed worktree has an unresolved or detached branch.

When a completed open-home spec's owning worktree is retired in the same `jarvis cleanup` apply invocation, stranded archival runs after retirement against a freshly discovered materialized-worktree list (successful retirements only), so one pass archives the spec into `completed/` without a second cleanup.

**`--dry-run` stranded prediction (bounded).** For open-home stranded archival, `--dry-run` evaluates materialized-worktree ownership as if worktrees in the retire preview set were already gone, so stranded archive lines match apply for that slice when those owners are the only blockers and apply successfully retires those worktrees. If a previewed worktree is not removed, dry-run may still show stranded `archive:` while apply keeps an owner and refuses.

**`--dry-run` is a plan, not an outcome** for other cleanup slices. It lists an archive destination based on the state it sees; the apply-time recheck runs again and can correctly refuse every archival the preview listed outside the bounded stranded case above. Read a dry-run listing as "these are candidates", and confirm against the apply run's stdout.

A worktree is eligible iff:

- **PR merged**: `gh pr view <branch> --json state,mergedAt` reports `state: "MERGED"` and `mergedAt` is set.
- **No non-terminal durable run**: the run store has no `(project, branch)` row whose status is outside `TERMINAL_RUN_STATUSES`.
- **No live daemon run**: the daemon reports no live run for the `(project, branch)`.

Default bulk retirement does **not** read `~/.jarvis/worktree-locks/.../.jarvis.lock`. A live lock does not block merged-worktree cleanup; `jarvis cleanup --abandon` still refuses when the lock is held.

Successful merged-worktree retirement removes the worktree, then prunes the same local head and local `origin` tracking ref through the shared ref-prune path below.

### Merged-branch ref pruning (worktree-independent)

Every cleanup also scans each distinct registered project Git root for local heads whose merged PR authority is verifiable, even when no managed worktree exists for that branch.

**Prunes** (apply, after confirmation):

- Exact `refs/heads/<branch>` when the head matches exactly one merged PR's `headRefOid`, no open PR owns the branch, and apply-time guards pass.
- Exact `refs/remotes/origin/<branch>` when that tracking ref existed at preview time and still matches the previewed OID at apply time.

**Keeps**:

- The repository base branch, the operator's current branch, and any branch checked out in a worktree (unless that worktree is retired in the same apply invocation).
- Local heads whose PR is not merged, is ambiguous, or cannot be verified (`gh` failure).
- Orphan `origin/<branch>` tracking refs with no matching local head.
- Branches with a non-terminal durable run or a live daemon run for any registered project sharing the repository's Git common directory. Named cleanup still discovers ref candidates only for the selected project, but refuses an ambiguous shared-ref prune rather than mutating another project's live branch.

**Preview and apply reporting** (project identity on every line): dry-run `prune ref: <project> <full-ref>` (apply-time candidates, subject to the same revalidation guards; not a guaranteed deletion); apply success `Pruned ref: <project> <full-ref>`; apply skip `Skipped ref prune: <project> refs/heads/<branch> — <reason>`; apply failure on stderr `Failed to prune ref <full-ref> (<project>): <message>`.

Apply revalidates head OID, tracking-ref OID, merged-PR authority, checkout status, and durable/daemon run ownership immediately before each mutation; a ref that changed after preview is skipped, not deleted.

**Partial failure.** A failed head or tracking-ref deletion is not reported as success, makes the invocation exit nonzero, and does not block later eligible ref candidates or the independent worktree-retirement, artifact-archival, and socket-reaping slices. Worktree retirement is reported successful only when both removal and its required ref prune succeed. Unusable registered project roots (missing, non-Git, or inaccessible) are reported on stderr as `Skipped project <project>: <reason> (<root>)` and make the invocation exit nonzero.

### Fail-closed daemon reads and socket reaping

If `gh` fails, or the daemon rejects or returns a malformed list probe, the worktree is marked ineligible and skipped. Daemon-unreachable merged worktrees appear in bulk preview as `Skipped merged worktree: <path>` with the stable reason `Daemon unreachable; run jarvis daemon start`. Head-only merged-branch ref pruning uses the same daemon-unreachable reason on apply skip and the same exit contract: at least one daemon-unreachable skip in either slice makes dry-run, declined, and applied cleanup exit nonzero, including when nothing else is eligible. PR-not-merged, non-terminal-run, live-run, and other ineligibility skips retain exit `0`. Cleanup does not impose a response timeout after a connection is established. If the run store is inaccessible (`listRuns()` throws), cleanup aborts with that error rather than skipping individual worktrees.

The CLI queries every live daemon socket discovered under `JARVIS_HOME` plus the invoking digest's socket (same set as `jarvis run list`), issuing `list` on each and skipping sockets whose connect, `list`, or parse fails without aborting the command. Bulk cleanup unions `isLive` rows for each `(project, branch)` across answering daemons. When no socket in that query set answers, one stderr line recommends `jarvis daemon start`, then bulk cleanup still reaps dead sockets and scans stranded open-home specs; merged worktrees remain fail-closed. Timeout, permission, and unexpected connect failures on the invoking socket do not abort when another socket would answer; when no socket answers, non-`ENOENT`/`ECONNREFUSED` first errors still abort before those phases. `jarvis cleanup --abandon <name>` still connects only to the keyed digest socket and refuses before preview when that listener is absent.

Cleanup also enumerates and reaps dead daemon sockets under `~/.jarvis/daemon-*.sock`. A socket is dead when its connect probe receives `ECONNREFUSED` or `ENOENT` (no listener bound); dead sockets are removed. All other probe results (connection succeeds, timeout, permission error, unexpected error) preserve the socket and are reported by reason — safe to run while overlapping keyed daemons are live. If the jarvis home cannot be enumerated, no sockets are removed in that cleanup run.

## Choosing an actuator

**Claude is a usable patch/implement primary.** Both v1 (`v1/src/agents/claude.ts:68`, 2026-07-13) and the shared v2 adapter (`shared/invocation/`, 2026-07-13) spawn claude with `--output-format stream-json --verbose`, so the idle-output watchdog observes it mid-iteration and can escalate. Before that, 33/33 claude patch records carried `last_output_age_ms: null` — the watchdog was structurally blind to claude, producing two false diagnoses ("claude-haiku stalls to zero-output iteration-timeout", "claude-sonnet-5 is too slow for patch primary"). Zero output was a missing measurement, not a starved or slow model. The v1 runbook's "shared Claude pool contention" guidance rests on the same folklore and is contradicted by observation (concurrent claude plan runs completed cleanly during the "stalled" patch run); ready-intent `retire-claude-pool-contention-folklore` — delete the v1 runbook's [Shared model pool contention warning](../../v1/docs/operator-runbook.md#shared-model-pool-contention-warning) when it ships.

**Claude review/critic roles stream partial frames (2026-08-05).** `shared/invocation/agents.ts` appends `--include-partial-messages` to the claude argv, streaming `thinking_delta`/`text_delta` frames ahead of the terminal result event — a long no-tool turn (e.g. a critic role with the diff baked into the prompt) previously emitted a `system init` line then nothing until the final flush, so the once-armed idle watchdog could settle `stall` on a slow-but-live run. Any stdout chunk re-arms the idle timer. v1's local claude adapter does not pass this flag and keeps the pre-2026-08-05 behavior.

**Cursor is spawned with stream-json (2026-07-24, confirmed by observation 2026-07-26).** Under `--output-format text` cursor emitted nothing until its final response, so a silently-editing review role settled `stall` at exactly the idle budget with edits already on disk. `shared/invocation/agents.ts` now spawns cursor with `--output-format stream-json --stream-partial-output` (`shared/invocation/cursor-json.ts` renders the terminal `result` event back into result text), and cursor does emit frames during silent edit phases — a cursor implement role ran 948s re-arming the idle timer before a genuine fatal pause. v1's `v1/src/agents/cursor.ts` is unchanged (`text` mode).

**Stall budgets: treat `role_stalled` / `idle_output_timeout` as a budget question first, an agent question second.** `DEFAULT_IDLE_OUTPUT_TIMEOUT_MS` is 90_000 (v1 patch-loop parity) and is too tight for v2 implement work, where an ordinary pause between frames exceeds it; `config/machines/home.json` sets `idleOutputTimeoutMs: 240000`. Bounds resolve CLI-side per invocation (`v2/src/commands/workflow.ts:136`), so changing them needs no daemon bounce. `idleOutputTimeoutMs` applies to workflow write **and** review roles (2026-07-26): configured positive values are passed to every review role, `0` disables, absent uses the 90 s review fallback. The v2 write path arms its idle watchdog via `resolveWritePathIterationBounds` (`idleOutputMs` alongside `iterationTimeoutMs` and `iterationCeilingMs`); resumed write steps rehydrate the persisted bound from the workflow snapshot. See [`write-behavior.md`](./write-behavior.md) for ordering and [`daemon-host.md`](./daemon-host.md) for operator-facing outcomes.

**Codex red-gates v2 implements on mechanical lint (2026-07-17).** On `gpt-5.6-terra`/`-sol`, 4 of 4 implement PRs red-gated on `noNonNullAssertion` (`foo!` in tests) and biome formatting — the logic was correct (3 landed mutation-verified), but the models ignore this repo's strict biome contract, so every run needs gate-repair churn or a hand-finalize, and the retries burn codex quota fast (33 invocations for ~5 specs). The gate can auto-fix formatting but not `noNonNullAssertion` (`fix: "none"`; the `!`→`?.` rewrite fails typecheck). Don't lead with codex as the v2 actuator for this repo; keep it behind claude/cursor.

**Cursor can report a false `quota` at ~24s (2026-07-26, not seeded — cost only).** Three cursor invocations across three days settled `exit_kind: "quota"` at 24.2–24.6s; in one case cursor ran the *next* role successfully 46s later. Real quota exhaustion fails fast and stays failed; this tight a duration cluster is a timeout or stream-disconnect matching the quota stderr heuristic (`v1/docs/quota-signals.md`). Consequence is spend, not correctness: the spurious signal escalates to the next rung (one instance cost $1.48 of `claude-opus-5` for work cursor would have done on subscription) and quietly undermines a cursor-first order. Check telemetry before believing a quota escalation.

### v2 takes its agent order from a different config key than v1

**v1** reads `modes.<mode>.agentOrder` (ordered `{agent, model}` objects, per mode). **v2** reads the flat top-level **`agents`** array of bare names (`v2/src/cli.ts:236` → `loadMachineConfig`). It never reads `modes.*.agentOrder`.

So reordering `modes.*.agentOrder` — the lever `agents.md` and the v1 runbook document — changes v1 and **nothing about v2**, silently. Observed 2026-07-14: codex was moved to the front of every `modes.*.agentOrder` and every subsequent v2 run still invoked claude. To change v2's order you must also edit the top-level `agents` array. Seed: `v1-and-v2-read-agent-order-from-different-config-keys`. Cleanup: delete when it ships.

Per-run overrides, rather than churning config — **v1 only**; v2 has no `--agent` flag:

```sh
jarvis1 run --agent cursor:"Composer 2.5" <spec>   # verify `cursor-agent status` first
jarvis1 run --agent codex <spec>                   # paid, fast
```

## Concurrency

**Two concurrent implements are sanctioned; hold at 3+ (2026-08-31).** The watchdog trio is now complete (`idle-output-timeout-preserves-committed-progress-resumable` #3189/#3194, `idle-watchdog-counts-worktree-filesystem-activity` #3218, `stall-settlement-preserves-agent-stdout` #3227) — the false-kill root causes the old serial-only rule fenced are fixed, so a silently-editing agent re-arms on worktree writes and committed progress is resumable. Two concurrent implements run cleanly (validated repeatedly this session and 2026-08-30); at 3+ the machine saturates (18/18) — keep verifier-file implements (`diff-derived-mutation-verifier.ts`) serial, and never run a manual `bun test`/`check` beside a live gate. `plan`/`intent` have short gates and isolated spec dirs — fan those out freely.

**Serial-only is under review (2026-08-30, not yet relaxed).** A parallelization experiment ran two concurrent implements ~40 min with zero idle-output false-kills under the current 15-min idle budget — the old rule was calibrated to a much tighter budget. Do **not** run concurrent implements yet; the trigger to re-trial is the watchdog trio landing (`idle-output-timeout-preserves-committed-progress-resumable`, `idle-watchdog-counts-worktree-filesystem-activity`, `stall-settlement-preserves-agent-stdout` — P0 in the structural-recovery brief).

### Circuit-breaker: stop routing a lane that keeps failing the same gate

If a lane (plan / implement / review) needs hand-intervention **twice in a row on the same gate**, stop routing that lane through Jarvis until the gate fix merges — hand-land the work instead of spending another run to strand the same way. Re-open the lane only after one clean end-to-end run on the fixed gate. Rationale: a gate that rejects good work taxes every run in that lane; once it has cost two hand-finishes, the third run is predictably wasted. Observed 2026-08-30: the plan lane (5/5 contract-miss-blocked → hand-landed #3165) and the implement lane (3 mutation-gate strands → hand-finished / #3172) both crossed this threshold. Mirrors [structural-recovery-brief.md § Operating notes](../spec/structural-recovery-brief.md).

**Read an `idle_output_timeout` cluster as a saturation signal, not an agent verdict (2026-07-30).** At 5–8 concurrent implement lanes (load average 15–25) three runs settled `idle_output_timeout`; rows with a committed checkpoint (`resumable: true`, `nextAction: "resume"`) recover with `jarvis run resume` on the retained workspace, while rows with no checkpoint commit (`resumable: false`, `nextAction: "stop"`) need re-dispatch at lower load. `idleOutputTimeoutMs` in `config/machines/home.json` is the lever if you want to keep a fan-out.

**Do not merge to `main` blindly during long in-flight runs** — see v1 runbook [Integration-merge-then-retest](../../v1/docs/operator-runbook.md#integration-merge-then-retest-pattern), and note every merge rotates the daemon digest (see [Daemon lifecycle](#daemon-lifecycle)). Prefer batching merges for when no lane is live.

**A dependent plan run costs one dispatch to learn its prerequisite is unmerged (2026-07-30).** Plan runs settle `blocked` / `agent_blocked` with accurate `## Blocker` text naming an unmerged sibling spec. The refusals are correct and cheap, but fanning out a whole dependency chain at once wastes a run per unmet edge. Read the blocker from the staged intent, not the run row: `sed -n '/## Blocker/,$p' ~/.jarvis/worktrees/<project>/plan/<name>/.jarvis-plan-stage/intent.md`.

**Migration ids collide across parallel branches (2026-07-30).** Two concurrently-implemented specs each added `015-…` to `MIGRATIONS` in `state-store.ts`, and `state-store.test.ts` asserts a hardcoded `migrationCount.total`; the second branch to merge conflicts and fails that assertion. Renumber the later migration and bump the count. Check before dispatching two specs that both touch persistence.

**A spec that widens an interface needs its test doubles named in scope (2026-07-30).** `pipeline-store-enumeration` blocked immediately — adding a required `StateStore` member broke a test-double in a file the spec did not name, and patch-mode scope forbade touching it. The agent refused correctly; the fix was a one-line spec edit naming the doubles, then re-dispatch. When planning an interface widening, name the complete-implementation doubles in the task checklist.

**State store concurrency:** the durable run state store (`~/.jarvis/state/v2.sqlite`) opens with WAL journal mode and a 5-second busy timeout, enabling safe concurrent reader-vs-writer access on a single machine. Overlapping workflows and routine polling (daemon `list`, TUI status checks) against the store are safe and do not cause `database is locked` errors.

## Coding agents in sandbox

- **Do not** start/stop/restart `jarvis1 log-server` — v1 concern; see v1 runbook.
- Sandbox may block `127.0.0.1` — daemon/socket probes can false-negative; see v1 runbook § Sandbox blindness.
- **Do not** start a second `jarvis daemon` to "fix" a stuck run.

## Known gotchas

Operators add bullets here; delete when fixed. Durable lessons that are behavior, not bugs, live in the sections above.

- **Multi-subspec `implement` publication ready-flips a prior subspec's closed same-branch PR (2026-08-29):** a spec routes every subspec through one `<timestamp>-<name>` branch, so a re-run for subspec N sees subspec N-1's already-merged PR on that branch. Publication resolves that stale PR and tries `gh pr ready` on it, failing terminally with `ready_flip_failed` / `Only draft pull requests can be marked as "ready for review"` — impl, review, and mutation gates all green, branch complete, no PR. **Recovery:** the branch is done; hand-publish. In the worktree strip any `verdict-*.md` review sidecar, tick the merged prior subspec in `index.md`, `git push`, then `gh pr create` and admin-merge after CI. Observed on the P0 deferred-settlement spec (run `949a26cb`, closed #3054 → hand-published #3069). Seed: `v2/spec/seeds/implement-publication-reuses-closed-same-branch-pr.md`. Cleanup: delete this bullet when that seed merges.
- **`full-review` fans a coupled multi-behavior seed into parallel lanes that can't serial-chain (2026-08-28):** when the intent stage splits a seed into 2+ ready-intents, the pipeline fans out; lanes run on **independent bases** (serial-chaining is unimplemented — `pipeline-fan-out-lanes-serial-chained-bases`), so a lane whose prerequisite is another lane's interface change strands or duplicates it. Before approving the fan-out gates, read the ready-intents: if the lanes are hard-coupled (one lists another as a prerequisite), **reject the fan-out and land it as one spec with chained subspecs** (a single standalone `implement` chains subspecs on one branch). Assemble the spec from the good intent outputs rather than re-planning.
- **`idle_output_timeout` false-kills a productively-working silent agent, worst under test contention (2026-08-28):** the idle-output watchdog killed an implement write step that had *just committed correct work* — cursor/codex don't stream output the watchdog can see, and running two implement stages concurrently widens the silent window by contending on the test suites. Don't run two implement runs at once (see [Concurrency](#concurrency)). When the terminal row is resumable (`loop_finished.resumable: true` / `error.nextAction: "resume"`), recover with `jarvis run resume` on the retained workspace. When no checkpoint commit exists (`resumable: false`), the committed work may still be real — salvage it (bank the committed subspec, hand-finish the rest) or re-dispatch rather than re-running from scratch on the same silent agent. Related: `implement-resumes-stalled-unmerged-subspec-chain`.
- **Leaked `bun test` pool workers also come from the operator's own background test runs (2026-08-11):** not just killed jarvis runs — a background `bun run test:v2`/`bun test` that the operator (or a subagent) launches and that reports "done" can leave its pool workers running, pegging CPU for tens of minutes and starving live runs to `iteration_timeout`. Observed: four v1 `--only-failures` workers at 99%×4 CPU for 24 min timed out an unrelated implement entry run. Per-PID `kill -TERM <pid>` (sandbox disabled) worked — the auto-mode block noted below applies to `pkill` patterns, not always to targeted PID kills. Sweep with `ps -Ao pid,etime,pcpu,command | grep test-worker` after any background test run and before diagnosing a slow run. The reap chain's foundation (`processGroup` on the shared runner, #2831) is landed; the gate-reaps + daemon-sweep halves are queued.
- **Leaked ready-gate `bun test` children peg CPU for days (2026-08-09):** a killed or abandoned run now signals its ready-gate (`bun run ready`) and required-integration (`ready-finalize.ts`) process groups on termination, so those two spawns' descendants are reaped; iteration timeout and daemon loss aren't bound to that signal and don't reach this reap. Three sibling spawns stay unbound and can still leak: the base-ref probe (`createDefaultReproduceReadyGateAtBaseRef`), the diff-derived mutation verifier, and the runtime smoke verifier. Orphans from those can accumulate across sessions, saturate CPU, and drag every concurrent gate — stretching debate reviews past 13 min and wedging a publication step at `iteration_started` with no agent process. **Standing rule: never tolerate these — a single day-old `bun test` orphan is one too many, and three is a hard stop.** Check at session start and any time runs turn slow or wedge (`ps -o etime,command -ax | grep "[b]un test"` — anything with a `DD-` day field is an orphan), and clear them *before* launching or diagnosing heavy work. The auto-mode classifier blocks the operator agent from `kill`/`pkill`, so hand it to the operator's own shell: `pkill -9 -f "bun test"` (nothing live depends on day-old orphans; the live gate spawns fresh test procs). Seed: `v2/spec/seeds/reap-ready-gate-test-children-on-run-termination.md`. Cleanup: delete this bullet when the remaining three sibling spawns are also bound to run termination.
- **Gate autofix can turn a green tree red, and it never self-heals (2026-08-02):** `bun run fix` rewrites `findIndex((x) => x === needle)` into `indexOf(needle)`; when the needle is possibly `undefined` the result fails `typecheck`. Reproducible on `main` today. A run hits it as `completion_commit_failed` with the autofix edits sitting uncommitted, then `ready_gate_failed` on resume — and every repair entry re-runs autofix, so it re-breaks. Recovery is a hand edit in the worktree, then `jarvis run resume`. Seed: `v2/spec/seeds/gate-repair-fence.md` (absorbed the autofix seed).
- **Any abnormal settle can strand an applied `@mutate` directive, not just `SIGKILL` (2026-08-02):** an ordinary `iteration_timeout` left **three** mutations applied to production source, and scoped verification kept applying and restoring directives in that worktree minutes after the run row was terminal — a single read of the file is not trustworthy. When salvaging such a worktree, reverse every directive mechanically (parse the test file's `@mutate` lines and restore each replacement to its original) rather than eyeballing the diff. Seed: `v2/spec/seeds/mutation-checkpoint-verifier-trust.md`.
- **A `completed` implement row can ship a mutation-verification artifact (2026-07-30):** PR #2314 committed, pushed, flipped to ready, and reported `completed` while its commit carried the inverted form of a guard in `shared/module-boundary-surfaces.ts`. The worktree *working copy* held the correct source while `HEAD` held the mutation, so the run's own gate and a hand `bun test <file>` both passed; CI failed 26 v1 plan tests. **Read the committed diff, not the worktree**, when a CI failure cannot be reproduced locally: `git -C <worktree> show HEAD:<path>`. Recovery was `gh pr close` + `jarvis cleanup --abandon` + a fresh implement run. Seed: `v2/spec/seeds/mutation-checkpoint-verifier-trust.md`. Cleanup: delete this bullet when it ships.
- **`daemon stop` and `run kill` can deadlock each other (2026-07-16):** a durable row that is non-terminal *and* not in memory is refused by both (`active durable runs` / `run_not_active`), so nothing can clear it. `run list` shows the tell: `in-progress` + `not-live` on a spec whose PR already merged. **Before this recovery, rule out a superseded same-key daemon** — a live run owned by an older daemon generation presents the identical `in-progress` + `not-live` tell, and `kill -9` there destroys live work across every registered project (see [Daemon lifecycle](#daemon-lifecycle) for the liveness checks). **Recovery (verified 2026-07-16): `kill -9 <daemon-pid>` then `jarvis daemon start`** — startup reconciliation settles every orphaned non-terminal row to `killed` / `daemon_restart` before IPC opens, which is what the refusing `stop` was blocking. Do **not** hand-edit `~/.jarvis/state/v2.sqlite`. Confirm no run is genuinely live first — this orphans anything that is. Seed: `a-daemon-lost-run-row-deadlocks-the-daemon`. Cleanup: delete when it ships. **Most `DaemonStopRefusedError: active durable runs` is not this bug (2026-07-26):** the deadlock needs rows that are non-terminal **and** not-live. A refusal naming rows that `run list` reports `in-progress` + **`live`** is the guard working correctly — check the named IDs in `run list` before reaching for `kill -9`, and prefer `jarvis run kill <run-id>` on live rows; killing the daemon over a genuinely live run risks discarding that run's uncommitted worktree edits.
- **`JARVIS_READY_TIER` is stomped, not inherited (2026-07-16):** `ready-finalize.ts:54` spreads `process.env` and then overwrites the key with `"full"`, so setting it locally does nothing. The full aggregate gate is ~85% of a v2 workflow's wall clock (~13 of ~15 min on a two-file markdown plan spec). Seed: `ready-gate-tier-is-not-configurable`. Cleanup: delete when it ships.

## Related docs

| Doc | Topic |
| --- | --- |
| [`install-and-config.md`](./install-and-config.md) | Bootstrap, config errors |
| [`first-workflow-walkthrough.md`](./first-workflow-walkthrough.md) | Happy path |
| [`workflow-runner.md`](./workflow-runner.md) | Presets, review, routing |
| [`write-behavior.md`](./write-behavior.md) | CLI surface, write loop |
| [`daemon-host.md`](./daemon-host.md) | IPC, errors, retention |
| [`tui.md`](./tui.md) | Full TUI rendering/interaction contract |
| [`coding-standards.md`](./coding-standards.md) | Restraint principles |
| [`v1/docs/operator-runbook.md`](../../v1/docs/operator-runbook.md) | Plan/run/cleanup/triage/cost |
