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

**Status 2026-07-13: v2 can plan and implement.** The launch-blocking P0s shipped
(#1450, #1451, #1456, #1458, #1459, #1460, #1474, #1476–#1479). `intent`, `plan`, and
`implement` all launch, invoke an agent, and do real work.

| Preset | State |
| --- | --- |
| `intent`, `plan`, `implement` | Work. Re-run before trusting any of them. |
| `intent-reviewed` | Split plus rendered staged-intent review; re-run before relying on its result. |
| `plan-reviewed`, `plan-reviewed-light` | Split/draft works; review behavior remains separately documented below. |

Intent-reviewed dispatch now resolves the registered layered critic and actuator
artifacts at runtime, reading every staged Markdown file and spec guidance. The
critic's stdout remains the verdict channel and is persisted at the reserved verdict
path; empty verdicts skip the actuator. Other review reliability issues remain
separate concerns and are not implied fixed here.

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

A v2 implement run reporting `runStatus: "completed"` implies both (1) the active subspec's
non-human-only acceptance criteria are all ticked at the boundary, and (2) a completion commit
exists. The spec.criteria-ticked contract prevents `done` / `no-work` completions when unticked
non-human-only criteria exist, re-reading the subspec from the run's worktree and blocking
before any completion commit or PR publication. The completion boundary enforces (2): when the
committer returns no new commit and the worktree is dirty, the run records
`completion_commit_failed` and names the uncommitted paths instead of masking them as `complete`.

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

### Blocked run: inspect and resume

A `blocked` run (agent appended `## Blocker` to the spec) keeps its worktree,
branch, and `git worktree list` registration — `blocked` is inspect-and-resume,
not terminal. `jarvis run list` and `jarvis run wait <run-id>` report
`worktreePath` for blocked rows; inspect the spec/uncommitted work there, resolve
the blocker, then resume.

### Orphaned non-terminal runs after daemon restart

Reconciled automatically at daemon start (#1430, race fixed by #1476–#1478): durable
non-terminal rows from a prior daemon transition to `killed` with reason
`daemon_restart` before IPC opens. Worktrees and branches survive.

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

Per-run overrides, rather than churning config:

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
