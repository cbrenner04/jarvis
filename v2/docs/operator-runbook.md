# v2 operator runbook

Reference for the **operator** dogfooding the v2 harness (`jarvis`) on the Jarvis
repo. **Operator** is the single name for this role.

Scope: **Jarvis-on-Jarvis v2 workflows** — daemon-backed `jarvis run …`, workflow
presets, and TUI observation. Cross-link the v1 runbook for everything v2 does not
own yet.

## v1 vs v2 today

| Concern | Binary | Notes |
| --- | --- | --- |
| Plan / intent authoring (`jarvis1 plan`, `jarvis1 intent`) | `jarvis1` | v2 has no plan/intent CLI |
| Patch spec implementation (`jarvis1 run <spec>`) | `jarvis1` | v2 implement preset is workflow-shaped, not a drop-in for every spec run |
| Project registry (`jarvis1 init`, `jarvis1 config`) | `jarvis1` | v2 reads the same `~/.jarvis/config.json` |
| Log server preflight | `jarvis1` | v2 daemon runs do not gate on `jarvis1 log-server` |
| Cleanup, triage, runbook add | `jarvis1` | `triage --merge` gates spec-backed and spec-less PRs; see [v1 operator runbook](../../v1/docs/operator-runbook.md) |
| Daemon, run control, TUI, workflow presets | `jarvis` | This doc |

Orientation: [`onboarding.md`](./onboarding.md). Install path:
[`install-and-config.md`](./install-and-config.md).

## Where planning artifacts live

Check live `~/.jarvis/config.json` for `plan.targetDir`. For the jarvis project
today that is typically `v1/spec`; v2-only planning uses `--target-dir v2/spec`.

| Artifact | Typical path |
| --- | --- |
| Seeds (open-work queue) | `<targetDir>/seeds/` (v2 seeds: `v2/spec/seeds/`) |
| Ready intents (open-work queue) | `<targetDir>/ready-intents/` |
| Active specs | `<targetDir>/<UTC-timestamp>-<name>/` |
| Completed specs | `<targetDir>/completed/` |
| Operator scratch notes | repo `.scratch/` (gitignored) |

Prioritization for seeds and ready intents (operator-maintained):
`.scratch/v2-seeds-ready-intents-prioritization.md`.

Successful publication consumes the queue input only after its durable output
lands; see the [workflow publication contract](./workflow-runner.md#publication-landing).

## When to dogfood v2

**Status 2026-07-13: v2 can plan and implement.** The launch-blocking P0s shipped
(#1450, #1451, #1456, #1458, #1459, #1460, #1474, #1476–#1479). `intent`, `plan`, and
`implement` launches only when its requested spec tree has unchecked automated work.

| Preset | State |
| --- | --- |
| `intent`, `plan`, `implement` | Work. Re-run before trusting any of them. |
| `intent-reviewed` | Split plus evidenced staged-intent review. |
| `plan-reviewed`, `plan-reviewed-light` | Split/draft works; review behavior remains separately documented below. |

Intent-reviewed dispatch now resolves the registered layered critic and actuator
artifacts at runtime, reading every staged Markdown file and spec guidance. The
critic's stdout remains the verdict channel and is persisted at the reserved verdict
path; empty verdicts skip the actuator. Completion requires that critic invocation
and artifact; missing staged workspaces, unavailable bindings, boundary violations,
and Git inspection errors now stop with named failures instead of silently completing.

**Two diagnoses of this have already been wrong — do not cut a spec against a third
without observing a run.** "The review step never invokes an agent" is refuted:
telemetry shows real critic *and* actuator invocations (21–83s, `exit_kind: ok`). But
the store holds 19 `intent` step runs against only 4 `review` step runs, so most
intent workflows produce no review row at all, which is consistent with the
operator-observed instant `completed`. Candidate: the
`findReviewLandingCheckpoint` short-circuit (`workflow-runner.ts:1409`). Unproven.

Note an empty review log proves nothing either way: `runReviewStep` gets no `logSink`,
so it logs nothing whether or not an agent ran. Both wrong diagnoses read that silence
as evidence. Ready-intent: `review-step-emits-log-events`.

**Do not trust a `completed` status on a P0 without re-running the preset.** Two of
them (`implement-preflight-validates-spec-in-missing-worktree` #1417,
`plan-draft-write-loop-prompt`) were marked complete while the operator-visible
failure survived — the fix landed one layer away from the bug.

**Bounce the daemon after merging any v2 change.** It runs a code snapshot from when
it started, so a merged fix looks broken until `jarvis daemon stop && jarvis daemon start`.
Seed: `daemon-runs-stale-code-until-restarted`.

Prior gates, still valid once the above clears:

- **Comfortable:** P1 logging intents (`daemon-process-log-read`,
  `run-invocation-session-log`, `run-async-path-terminal-log-event`).
- **Primary harness:** after `workflow-composable-collapse` lands — freeze new
  preset/review vertical slices until then.

## North star

Same as [v1 operator runbook § North star](../../v1/docs/operator-runbook.md#north-star):
minimize manual steps; fold fixes into existing commands rather than new subcommands.
v2-specific gaps become seeds under `v2/spec/seeds/` (or `v1/spec/seeds/` when the
shipping surface is v1).

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
6. **End-of-session cleanup** — `jarvis cleanup` retires merged v2 worktrees and scans each registered
   `v2/spec/` home for completed stranded specs (`--dry-run` to preview, `[y/N]` to confirm). It retains
   unmerged/leaked worktrees for manual recovery (see [Recovery](#recovery)).

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
3. `gh auth status` — required for completion publish paths.
4. Register the jarvis repo if needed: `jarvis1 init` from the project root.
5. Read `.scratch/v2-seeds-ready-intents-prioritization.md` for current gates.
6. Sweep open [harness-suggestion issues](https://github.com/cbrenner04/jarvis/issues?q=label%3Aharness-suggestion+is%3Aopen)
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
| `intent` | Split seed → `ready-intents/` |
| `intent-reviewed` | Split + light review (recommended for intents) |
| `plan` | Draft spec tree from ready-intent |
| `plan-reviewed` | Draft + debate review |
| `plan-reviewed-light` | Draft + light review |
| `implement` | Index-routed implementation + shrink (+ optional review) |

Examples:

```sh
jarvis run workflow intent-reviewed --seed v2/spec/seeds/my-seed.md
jarvis run workflow plan --ready-intent v2/spec/ready-intents/my-intent.md
jarvis run workflow implement --base main --spec v2/spec/<spec>/index.md
```

`--spec` is resolved from the caller's cwd, then checked at its resolved
project-relative path in `--base` before daemon contact. If it is unavailable,
commit or select a base ref that contains the spec and retry; launching from a
project subdirectory is supported.

If that first routing index read fails, the daemon returns `routing_read_failed`.
The operator message names the resolved index path and the underlying read
reason; use both to diagnose missing or unreadable spec state.

Before daemon contact, `jarvis run workflow implement` reads the requested spec
tree. If all non-human-only criteria are checked, it exits `1` with
`implement.already_complete`; no worktree, agent invocation, or run row exists.
Linked-index checkboxes are not the completion source of truth.

On an incomplete re-run with git enabled, preflight retires a stale workspace for
the resolved `(project, branch)` before the write step starts: close the matching
open draft PR (when exactly one exists), remove the materialized worktree, and
delete local and remote branch refs so materialization recreates from `--base`.
First runs with no existing worktree skip this path. Refusal exits `1` without
mutation when the workspace is live-held, the matching PR is ready (non-draft),
or multiple open PRs match the branch — stderr names the blocking state. Recovery:
end the live run or wait for its lock to clear; mark the PR draft again or merge
it; or close duplicate PRs until exactly one open draft remains, then re-run.
Manual fallback: `jarvis cleanup --abandon <branch>` when guards pass.

### Ad-hoc write loop (live pause/kill)

`jarvis run start` with explicit worktree fields — supports `pause` / `kill` /
`resume` on the active run. Workflow-started implement does **not**. See
[first-workflow-walkthrough § Workflow-started implement](./first-workflow-walkthrough.md#workflow-started-implement).

### Observe

| Command | Use |
| --- | --- |
| `jarvis tui` | Run table, queue, outcome, kill (`k`) on live runs |
| `jarvis run list` | JSON-ish run rows; `isLive` vs durable `status` |
| `jarvis run wait <run-id>` | Block until next boundary |
| `jarvis run log <run-id>` | Structured run log (not daemon process log) |
| `jarvis tui log <run-id>` | Interactive tail |

`list` / `wait` operator errors: [`daemon-host.md` § Operator error](./daemon-host.md#operator-error-on-list-and-wait).

Durable state: `~/.jarvis/state/v2.sqlite` ([`state-store.md`](./state-store.md)).

### Worktrees and branches

v2 git-enabled workflows use `~/.jarvis/worktrees/<project>/<branch>/`, not
`<repo>/.worktree/`. Intent branches: `intent/<slug>`. Plan branches: `plan/<name>`.
Implement branch defaults to the spec directory basename.

Merged worktrees are retired by `jarvis cleanup`. A leaked worktree from a **failed/unmerged** run
is reset automatically on the next incomplete `jarvis run workflow implement` re-run (see above);
for manual cleanup when guards pass, use `jarvis cleanup --abandon <branch>`.

## Implementation on jarvis specs

Two valid paths today:

1. **`jarvis1 run <spec>`** — full patch loop, triage, cleanup integration (stable).
2. **`jarvis run workflow implement`** — v2 workflow preset; no live kill; verify
   preflight and gates independently.

Do not assume parity between them — see [Gate trust](#gate-trust) for what the v2 gate covers.

## Gate trust

The v2 ready gate runs the `full` tier (`check`, `typecheck`, tests, `lint:md`) unconditionally,
overriding any `JARVIS_READY_TIER` in the parent environment. The `lint:md` step covers all v2
markdown: `v2/docs/**/*.md` and `v2/spec/**/*.md`, subject to the shared ignores (`**/completed/**`,
`**/verdict-*.md`).

`jarvis1 run` must not report success when the ready gate is red (seed
`run-cannot-report-complete-over-red-gate`). Treat `criteria-complete` exit 0 as
insufficient without a green gate on the branch head.

A red ready gate is handed back to the agent for up to three bounded repair iterations. Each repair
consumes the iteration budget and republishes before the gate is rerun. Flip failures are not repaired;
resume a `ready_gate_failed` run after fixing the gate, or a `ready_flip_failed` run after checking the PR state.

A v2 implement run reporting `runStatus: "completed"` implies (1) the active subspec's
non-human-only acceptance criteria are all ticked at the boundary, (2) a completion commit
exists, (3) confirmed PR evidence (a pushed commit linked to an open PR), and (4) the ready gate
is green. The spec.criteria-ticked contract prevents `done` / `no-work` completions when
unticked non-human-only criteria exist, re-reading the subspec from the run's worktree and
blocking before any completion commit or PR publication. The completion boundary enforces (2):
when the committer returns no new commit and the worktree is dirty, the run records
`completion_commit_failed` and names the uncommitted paths instead of masking them as `complete`.
The publication boundary enforces (3): when the publisher returns a `pushSha` but no PR evidence
(no `prNumber`), the run records `completion_commit_failed` (retryable) and skips ready finalization,
preventing silent publication gaps where code is pushed but no PR exists. A red gate demotes the
run to `failed` and blocks completion; resume the run after fixing the gate.

Implement PR bodies now carry an agent-authored review-altitude narrative in the PR marker block
(see [PR body narrative markers](./workflow-runner.md#pr-body-narrative-markers)). The shrink pass
authors this narrative after implementation; on re-publication, human edits inside the marker block
are preserved and clobber-protected by precedence rules.

v2 TUI tests can pass while ink rendering is broken — see seed
`tui-tests-bypass-the-render-path` and [`test-writing.md`](./test-writing.md).

## Recovery

Documented gaps and operator workarounds. Remove entries when seeds merge.

### Workflow reports a stale worktree claim

If a workflow start returns `worktree_claimed` after its prior owner is no longer
live, invoke the workflow again. The daemon drops that in-memory workflow claim
at admission and preserves all worktree and branch state; do not restart the daemon
or remove a worktree for this case. A genuinely live owner remains protected and
continues to reject the same `(project, branch)`.

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
```

`--abandon <name>` resolves the workspace name to its branch, worktree path, and matching open PR. It previews the planned actions (close PR, remove worktree, delete local and remote branches), prompts for confirmation, then best-effort closes the PR, force-removes the worktree, and deletes both branches. It leaves source spec files and durable run rows intact. It refuses before touching anything if the worktree is missing or held by a live run (daemon `isLive` or locked by `.jarvis.lock`).

**PR-ownership gates:** `--abandon` refuses and changes nothing if:

- **Multiple open PRs match the branch**: ambiguous ownership, no closure guarantee. Hand-close extra PRs or force-resolve branch ambiguity, then retry.
- **Single matching PR is ready (non-draft)**: operator-reviewed work — `--abandon` protects operator-reviewed branches from force-retirement. Merge the ready PR (preferred), or manually close it and retry.

A single open draft PR passes these gates and retirement proceeds. Zero matching PRs also pass.

Use `--dry-run` to preview without confirmation: `jarvis cleanup --abandon <name> --dry-run`.

### Blocked run: inspect and resume

A `blocked` run (agent appended `## Blocker` to the spec) keeps its worktree, branch, and
`git worktree list` registration. `jarvis run list` and `jarvis run wait <run-id>` report
`worktreePath` for blocked rows; inspect the spec and uncommitted work there and resolve the
blocker.

**`jarvis run resume` does not work on a blocked run** — it refuses with
`terminal_run: Cannot resume a blocked run`, and `run list` correctly reports the row as
`resumable: false` with remediation `inspect_spec`. (This section previously said "`blocked` is
inspect-and-resume, not terminal" and told you to resume. That was wrong; the harness never
supported it.) To continue the work, resolve the blocker and **re-run the spec**. An incomplete
`jarvis run workflow implement` re-run resets the stale worktree from `--base` (see
[Implement workflow](#implement-workflow)); uncommitted work in the prior worktree is not carried
forward.

### Orphaned non-terminal runs after daemon restart

Durable non-terminal rows from a prior daemon are reconciled to `killed` with reason
`daemon_restart` before IPC opens (#1430, race fixed by #1476–#1478). Once IPC is healthy, the
daemon automatically resumes every reconciled row with a resolvable workflow write snapshot.
The original run ID, snapshot, worktree, and branch are retained; check `jarvis run log <run-id>`
for its `run_recovery` outcome. A failed automatic admission becomes `failed` with an actionable
log diagnostic, without blocking other recoveries. Worktrees and branches survive, but the killed
iteration's agent work does **not** — it is left uncommitted in the worktree, and its token spend
is lost.

**Two traps here, both seeded, both observed live on 2026-07-14:**

- A revision mismatch on a CLI start, resume, or workflow dispatch automatically
  bounces an idle daemon, waits for recovery, and retries once. Its stderr output
  records revisions and recovery counts. If any `isLive` row exists it names the
  IDs and refuses; finish or recover them first. Use `--no-auto-bounce` to retain
  manual restart control. TUI continues to refuse mismatches.
- A reconciled orphan with a missing or unresolvable workflow write snapshot is not auto-resumed.
  It stays `killed`; `list` / `wait` report `unsupported_resume_context` with `retryable: false`
  and `nextAction: "stop"`. Fix the persisted context or re-run the spec rather than treating that
  row as a config-binding failure.

### Wedged run, no agent activity

Check `~/.jarvis/daemon.log` and `jarvis run log <run-id>`. Plan draft stalls
historically threw before agent invoke (fixed in shipped PRs); similar failures
may still exit without `iteration_started` follow-up until
`write-loop-iteration-timeout-on-stall` lands.

### `run kill` ineffective on workflow runs

Workflow-started runs reject live kill/pause ([`daemon-host.md` § Live controls](./daemon-host.md#live-controls-on-workflow-started-runs)). Stop the daemon only as a last resort — it orphans every in-flight run.

### Branch / worktree collision

```
fatal: '<branch>' is already used by worktree at ...
```

Remove the stale worktree under `~/.jarvis/worktrees/…` and delete the local
branch if safe. (`jarvis cleanup` handles this automatically once the branch's PR is merged; hand-remove only for unmerged branches.)

### Publication / completion failures

Retryable `completion_commit_failed` or `ready_gate_failed` on `list` / `wait`: inspect `error.publicationFailure` first for the operation, message, exit code, and command-output tails; then verify the completion commit/PR state, fix `git`/`gh`/`origin` access, then
`jarvis run resume <run-id>`. Resume reuses the persisted write snapshot before replaying
publication; daemon-process logs are secondary, and do not delete the worktree or substitute current config.

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

`jarvis cleanup` retires merged v2 worktrees discovered under `~/.jarvis/worktrees/<project>/`.
The eligibility gate decides whether a worktree is safe to remove.

After Git retires a workspace, cleanup resolves its recorded spec path back to the
configured v2 spec home and then archives a complete artifact to `completed/`.
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

A worktree is eligible iff:

- **PR merged**: `gh pr view <branch> --json state,mergedAt` reports `state: "MERGED"` and
  `mergedAt` is set.
- **No non-terminal durable run**: the run store has no `in-progress`, `paused`, `awaiting-human`,
  `revising`, `queued`, `budget-soft-stopped`, or `killed` run for the `(project, branch)`.
- **No live daemon run**: the daemon reports no live run for the `(project, branch)`.

**Fail closed**: if `gh` fails, the daemon is unreachable, the run store is inaccessible, or any
other error occurs, the worktree is marked ineligible and skipped. This prevents accidental deletion
of an operator's in-flight work. Worktrees ineligible for this session remain untouched; the operator
can retry `jarvis cleanup` later if issues are resolved.

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
visible mid-invocation (not buffered until exit). However, **v2 still has no idle-output
watchdog** — only a wall-clock `iterationTimeoutMs` in `v2/src/execution/write-loop.ts`.
Stream-json output availability does not change v2's stall detection: a silent claude
mid-invocation still rides `iterationTimeoutMs` wall-clock to terminate, not an
idle-output escalation. The "claude is safe as primary" claim from v1 rests
partly on v1's idle watchdog infrastructure; v2 lacks that layer. Operator discipline
and CI guardrails replace it. Consider a future idle-output watchdog for v2 if
claude primary stalls become a concern.

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

## Coding agents in sandbox

- **Do not** start/stop/restart `jarvis1 log-server` — v1 concern; see v1 runbook.
- Sandbox may block `127.0.0.1` — daemon/socket probes can false-negative; see v1
  runbook § Sandbox blindness.
- **Do not** start a second `jarvis daemon` to “fix” a stuck run.

## Known gotchas

Operators add bullets here; delete when fixed.

- **Drive plans with plain `plan` — the reviewed plan path strands the spec (2026-07-16):**
  `plan --review-passes 1 --review-behavior light` produced, 3 for 3, a PR containing
  `.jarvis-plan-stage/` and **no spec**. Same ready-intent through plain `jarvis run workflow plan`
  lands correctly and reports `completed`. The deferred `plan-tree` landing is never resumed. Until
  landing is repaired, **omit the review flags on plan**. Seed:
  `reviewed-plan-workflows-never-land-their-spec`. Cleanup: delete this bullet when landing ships.
- **A green gate does not mean the code runs — keep reviewing implement diffs (2026-07-16):** a
  `jarvis cleanup` that could never retire anything shipped **twice**, from two different models,
  each with 7/7 acceptance criteria ticked and a green gate. Attempt 1 called `gh pr view --head`
  (an invalid flag → every check threw → fail-closed → permanent silent no-op), hidden by a mock
  matching the command name without inspecting argv. Attempt 2 fixed the flag and shipped a wholly
  vacuous suite: restoring the original bug *and* stubbing every guard still gave 7 pass / 0 fail.
  Neither was caught by `check`, `typecheck`, tests, CI, or the acceptance criteria — only by
  subagent diff review. **Review every implement diff before merging, and distrust a green suite on
  code with no test seam.** Seed: `agent-authored-subprocess-mocks-assert-nothing-about-argv`.
- **`daemon stop` and `run kill` can deadlock each other (2026-07-16):** a durable row that is
  non-terminal *and* not in memory is refused by both (`active durable runs` / `run_not_active`), so
  nothing can clear it. A stranded row prevents the daemon restart needed after a revision mismatch.
  `run list` shows the tell: `in-progress` + `not-live` on a spec
  whose PR already merged. **Recovery (verified 2026-07-16): `kill -9 <daemon-pid>` then
  `jarvis daemon start`.** Startup reconciliation settles every orphaned non-terminal row to
  `killed` / `daemon_restart` before IPC opens, which is what the refusing `stop` was blocking you
  from reaching. Do **not** hand-edit `~/.jarvis/state/v2.sqlite`. Confirm no run is genuinely live
  first — this orphans anything that is. Seed: `a-daemon-lost-run-row-deadlocks-the-daemon`.
  Cleanup: delete when it ships.
- **`run kill` does not work on workflow-started runs (2026-07-16):** it refuses `run_not_active`
  even while `run list` reports the row `live`. Combined with the deadlock above there is no
  jarvis-native way to stop a workflow implement; kill the agent process tree directly
  (`ps aux | grep <branch>` → the `claude`/`codex` child, the `v2/src/cli.ts` parent). The durable
  row stays `live` afterwards until a daemon restart reconciles it. See
  [`daemon-host.md` § Live controls](./daemon-host.md#live-controls-on-workflow-started-runs).
- **`JARVIS_READY_TIER` is stomped, not inherited (2026-07-16):** `ready-finalize.ts:54` spreads
  `process.env` and then overwrites the key with `"full"`, so setting it locally does nothing. The
  full aggregate gate is ~85% of a v2 workflow's wall clock (~13 of ~15 min on a two-file markdown
  plan spec). Seed: `ready-gate-tier-is-not-configurable`. Cleanup: delete when it ships.
- **`jarvis cleanup` archives completed v2 specs (shipped 2026-07-17):** run it at session end
  (`jarvis cleanup --dry-run` to preview, then `jarvis cleanup`, `[y/N]`) to retire merged worktrees,
  delete their local branches, and archive eligible open-home specs under `v2/spec/completed/`.
  Unmerged/leaked worktrees use `jarvis cleanup --abandon <name>` (see [Recovery § Branch / worktree collision](#branch--worktree-collision)).
  `jarvis1 cleanup` remains blind to the v2 home; use `jarvis cleanup`.

- **Gate `main` before debugging a red branch (2026-07-16):** `bun run ready` runs the aggregate
  suite, which CI never runs (CI scopes by changed path). `main` was red on the operator machine
  behind green CI for an unknown number of sessions — the aggregate's per-file timeout was smaller
  than its slowest file. Every v1 and v2 gate failed regardless of the diff. If a gate goes red on a
  diff that cannot explain it, run the gate on `main` before touching the branch. Recovered in
  #1644. Seed: `v1/spec/seeds/ci-cannot-protect-the-local-ready-gate.md`. Cleanup: delete when it
  ships. See [v1 runbook § The gate](../../v1/docs/operator-runbook.md#the-gate).
- **Launch `jarvis run workflow` from the project root (2026-07-14):** `--spec` resolves against
  your shell's cwd, and the resulting repo-relative path is re-resolved *inside the run's own
  worktree*. A cwd inside another git worktree (e.g. `.worktree/<x>/`) yields a path that passes
  preflight — it really exists from the project root — and then fails `harness_failure` at the
  routing read, **after a full agent write step**. Cost one run 7m52s and its tokens. Seed:
  `spec-path-is-not-validated-in-the-run-worktree`. Cleanup: delete when it ships.
- **Every implement run has committed a red gate (2026-07-14):** four for four this session, all
  trivially auto-fixable (import ordering, a formatter violation, one fabricated test assertion).
  The full-tier gate catches them, but a red gate is terminal: the run publishes a draft PR over
  the broken commit and stops. Until `red-gate-feeds-back-to-the-agent` ships, expect to run
  `bun run fix` and re-gate by hand on every implement PR before merging. Seed:
  `red-gate-does-not-feed-back-to-the-agent`. Cleanup: delete when it ships.

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
- **The daemon goes deaf while a run is active (2026-07-12):** `jarvis run list` and
  `jarvis run log` both hung past 60s while an `intent-reviewed` run was publishing
  — the daemon blocks on sync git in the publication path. You lose all
  observability exactly when you need it. Wait it out; the calls return once the run
  finishes. Seeds: the P4 responsive-daemon set + `nonblocking-ready-gate-and-guard`.
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
