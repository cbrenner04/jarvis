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
| Cleanup, triage, runbook add | `jarvis1` | See [v1 operator runbook](../../v1/docs/operator-runbook.md) |
| Daemon, run control, TUI, workflow presets | `jarvis` | This doc |

Orientation: [`onboarding.md`](./onboarding.md). Install path:
[`install-and-config.md`](./install-and-config.md).

## Where planning artifacts live

Check live `~/.jarvis/config.json` for `plan.targetDir`. For the jarvis project
today that is typically `v1/spec`; v2-only planning uses `--target-dir v2/spec`.

| Artifact | Typical path |
| --- | --- |
| Seeds | `<targetDir>/seeds/` (v2 seeds: `v2/spec/seeds/`) |
| Ready intents | `<targetDir>/ready-intents/` |
| Active specs | `<targetDir>/<UTC-timestamp>-<name>/` |
| Completed specs | `<targetDir>/completed/` |
| Operator scratch notes | repo `.scratch/` (gitignored) |

Prioritization for seeds and ready intents (operator-maintained):
`.scratch/v2-seeds-ready-intents-prioritization.md`.

## When to dogfood v2

**Status 2026-07-12: v2 cannot implement its own specs.** All six presets were run
against real work. Only the `intent` split path completes. Everything that drives
the write loop fails:

| Preset | State |
| --- | --- |
| `intent`, `intent-reviewed` | Split works. **The review step is a silent no-op** — empty log, no verdict, no commit, reports `completed`. Seed: `intent-reviewed-review-step-is-a-silent-no-op`. |
| `implement` | **Cannot start.** ENOENT reading the index in a worktree that doesn't exist yet, then a prompt-render failure before any agent. Seeds: `implement-linked-routing-reads-index-before-worktree-exists`, `implement-write-step-renders-prompt-without-placeholders`. |

**Use `jarvis1` for all plan and implement work until those four P0 seeds land.**
`jarvis1 plan --target-dir v2/spec <ready-intent>` and `jarvis1 run <spec>` are the
working path for v2 specs. Cleanup: delete this table when the P0 seeds ship, and
re-run every preset before trusting it.

**Do not trust a `completed` status on a P0 without re-running the preset.** Two of
them (`implement-preflight-validates-spec-in-missing-worktree` #1417,
`plan-draft-write-loop-prompt`) were marked complete while the operator-visible
failure survived — the fix landed one layer away from the bug.

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
6. **End-of-session cleanup** — v2 has no `jarvis cleanup` yet (seed
   `v2-cleanup-command`); use v1 cleanup where it applies and manual worktree
   recovery for `~/.jarvis/worktrees/` (see [Recovery](#recovery)).

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

`--spec` for implement is resolved against the **registered project root** for
both CLI preflight and the runner's first linked-index routing read when no
external worktree exists yet (see seed
`implement-preflight-validates-spec-in-missing-worktree`).

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

Leaked worktrees block reuse of branch names — manual `git worktree remove --force`
until `v2-cleanup-command` ships.

## Implementation on jarvis specs

Two valid paths today:

1. **`jarvis1 run <spec>`** — full patch loop, triage, cleanup integration (stable).
2. **`jarvis run workflow implement`** — v2 workflow preset; no live kill; verify
   preflight and gates independently.

Do not assume parity between them. After a v2 implement run, run
`bun run ready` (or `jarvis1 triage --merge`) before trusting completion — see
[Gate trust](#gate-trust).

## Gate trust

`jarvis1 run` must not report success when the ready gate is red (seed
`run-cannot-report-complete-over-red-gate`). Treat `criteria-complete` exit 0 as
insufficient without a green gate on the branch head.

v2 TUI tests can pass while ink rendering is broken — see seed
`tui-tests-bypass-the-render-path` and [`test-writing.md`](./test-writing.md).

## Recovery

Documented gaps and operator workarounds. Remove entries when seeds merge.

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

Seed: `v2-cleanup-command`. Cleanup: delete when it ships.

### Orphaned non-terminal runs after daemon restart

Runs are in-process on the daemon. After restart, durable rows may stay
`in-progress` with `isLive: false`; `jarvis run kill` returns `run_not_active`.
Seed: `daemon-reconciles-orphaned-runs-on-start`. Until it lands: manual state
edit or wait for reconciliation PR.

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
branch if safe. Seed: `v2-cleanup-command`.

### Publication / completion failures

Retryable `completion_commit_failed` on `list` / `wait`: fix `gh` / `origin`, then
`jarvis run resume <run-id>` per [`first-workflow-walkthrough.md`](./first-workflow-walkthrough.md#completion).

### Intent-reviewed operator checkout

Review and landing must use the split external worktree, not the operator checkout.
If review dirties the primary checkout, treat as a harness bug; seed
`intent-reviewed-uses-external-worktree` (fold into `workflow-composable-collapse`).

### Daemon blocked on long git / ready subprocess

Responsive-daemon specs and seed `nonblocking-ready-gate-and-guard` address sync
subprocess on the daemon event loop. Symptom: `jarvis run list` hangs while a run
finalizes. Check for `bun run ready` or `git` children on the daemon PID.

## Choosing an actuator (2026-07-12)

**Do not lead patch/implement with claude until `claude-streams-output-to-watchdog`
ships.** Jarvis spawns claude with `--output-format json` (`v1/src/agents/claude.ts:67`)
— a batch envelope emitted once at exit — so `spawn.ts`'s `stdout.on("data")`
activity bump never fires mid-iteration. Result: **33 of 33** claude patch records
carry `last_output_age_ms: null`. The idle-output watchdog is structurally blind to
claude, cannot escalate down `agentOrder`, and a live-but-slow claude run rides
`iterationTimeoutMs` to exit 8.

Use a per-run override rather than churning config:

```sh
jarvis1 run --agent cursor:"Composer 2.5" <spec>   # free; verify `cursor-agent status` first
jarvis1 run --agent codex <spec>                   # paid, fast
```

Claude remains fine for `plan` / `review` — those observe output normally.

**This supersedes the "claude shares the Claude pool with the operator session"
guidance in the v1 runbook.** That theory is contradicted: two concurrent
`claude-opus-4-8` *plan* runs completed cleanly during the very claude *patch* run
that "stalled", same pool, same Claude operator session. Zero output is a missing
measurement, not a starved agent.

Cleanup: delete this section when `claude-streams-output-to-watchdog` ships (seed:
`v1/spec/seeds/patch-watchdog-blind-to-claude-output.md`), and retire the folklore
via `retire-claude-pool-contention-folklore`.

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

- **`run workflow` exits 0 on a failed run (2026-07-12):** the exit code means "the
  daemon accepted the request", not "it worked". Every failed preset this session
  looked like a success at the shell — a bare UUID and exit 0. Always confirm with
  `jarvis run list` / `jarvis run log <id>`; never gate a script on the exit status.
  Seed: `v2/spec/seeds/run-workflow-exits-zero-on-failed-run.md`. Cleanup: delete
  when it ships.
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
- **No v2 cleanup (2026-07-12):** worktrees and completed specs accumulate. Seed:
  `v2-cleanup-command`. Cleanup: delete when shipped.
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
