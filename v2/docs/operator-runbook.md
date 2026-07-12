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

From the scratch prioritization file (summarized):

- **Cautious now:** implement and plan draft can run; expect manual recovery for
  orphaned `list` rows, leaked worktrees, and limited stall diagnostics until P1
  lands.
- **Routine:** P0 complete (`write-loop-iteration-timeout-on-stall` still open as of
  2026-07-12) plus `daemon-reconciles-orphaned-runs-on-start`.
- **Comfortable:** add P1 logging intents (`daemon-process-log-read`,
  `run-invocation-session-log`, `run-async-path-terminal-log-event`).
- **Primary harness:** after seed `workflow-composable-collapse` lands — freeze new
  preset/review vertical slices until then; dogfood `intent`, `plan`, `implement`
  base presets only.

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
6. Sweep open [harness-suggestion issues](https://github.com/cbrenner04/jarvis/issues?q=label%3Aharness-suggestion+is%3Aopen).

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

`--spec` for implement is resolved against the **registered project root**, not the
future worktree (see seed `implement-preflight-validates-spec-in-missing-worktree`).

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
