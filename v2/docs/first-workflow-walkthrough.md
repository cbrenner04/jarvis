# First workflow walkthrough

One happy path from prerequisites through a completed run and its draft PR.
This is not a command reference — see [`write-behavior.md`](./write-behavior.md) for
CLI contracts and [`daemon-host.md`](./daemon-host.md) / [`workflow-runner.md`](./workflow-runner.md)
for IPC and workflow internals.

The walkthrough uses an ad-hoc `jarvis run start` run (not `jarvis run workflow
implement`) so live `pause` and `kill` work on the active run.

## Prerequisites

Before starting:

1. **Agents and models** — `machineProfile` set in `~/.jarvis/config.json`, a
   matching `config/machines/<profile>.json` with role bindings, and agent
   fallback order configured (`jarvis config show`). See
   [`agent-model-config.md`](./agent-model-config.md).
2. **Project flags** — `--project-root` is the path to the target repo;
   `--project` is a free-text label. No prior registration is required.
3. **GitHub CLI** — `gh auth status` succeeds (completion publishing gates on it).
4. **`origin` remote** — target repo has a GitHub `origin` remote; completion
   pushes with `git push -u origin <branch>` when upstream is unset.

Have a spec with unchecked tasks ready. Paths below are relative to the worktree
Jarvis creates under `~/.jarvis/worktrees/<project>/<branch>/`.

## Start the daemon

`jarvis run start` connects to the daemon over `~/.jarvis/daemon.sock`. Nothing
auto-starts the daemon — start it first:

```bash
jarvis daemon start
```

On success stdout is compact JSON with the child PID and socket path, for example:

```json
{"pid":12345,"socketPath":"/Users/you/.jarvis/daemon.sock"}
```

Confirm with `jarvis daemon status` (`running` when healthy).

## Start a run

Launch an ad-hoc write loop against your spec. Every flag below is required
except `--max-iterations`:

```bash
jarvis run start \
  --project-root /path/to/your-repo \
  --project your-project \
  --branch your/feature-branch \
  --base main \
  --spec v2/spec/your-spec/index.md \
  --artifact v2/spec/your-spec/index.md
```

| Flag | Meaning |
| --- | --- |
| `--project-root` | Registered repo root |
| `--project` | Project name from `~/.jarvis/config.json` |
| `--branch` | Feature branch Jarvis creates or resumes in the worktree |
| `--base` | Base git ref for the worktree |
| `--spec` | Spec path inside the worktree |
| `--artifact` | Completion-contract file the write loop checks when the agent returns `done` or `no-work` — typically the spec `index.md` or another deliverable the spec names |
| `--max-iterations` | Optional per-invocation iteration budget (default 10) |

The CLI sends one IPC `start` request and prints the run ID on stdout:

```
7f3a9c2e-4b1d-4e8a-9f0c-1a2b3c4d5e6f
```

Save that ID for observe and steer commands.

## Observe

### Run states

While a run is active you see `in-progress` with `live` liveness. Graceful
`pause` moves it to `paused` (`not-live`). Terminals include `completed`,
`failed`, `blocked`, and `killed`. Queued runs (memory watermark) show
`queued` until promoted.

### `jarvis tui`

```bash
jarvis tui
```

Full-screen ink monitor after connect + liveness proof. Layout (not a fixed
transcript — values refresh every second):

- **Run table** — columns `runId`, `project`, `branch`, `status`, `liveness`
  (`live` / `not-live`). The selected row is marked with `>`. On entry the
  first selectable row is selected and a daemon `wait` is issued for it.
- **Queue** (when present) — FIFO rows waiting for memory headroom.
- **Outcome** — from daemon `wait` for the selected run: `runStatus` plus
  optional `loopOutcomeKind`, `iterationsConsumed`, and `resumable`. Shows
  `Waiting for <run-id>...` while `wait` is pending.
- **Steering feedback** — inline `<code>: <message>` after a steering RPC
  failure, triggered by the interactive keys below.

Keys act on the selected run: `k` kills any live run; `a` (approve) and `v`
(revise, then type a prompt and Enter) only apply to `awaiting-human` runs —
not reachable via this ad-hoc walkthrough, which uses `jarvis run start`
rather than a workflow with human-approval steps.

Quit with `q` or Ctrl-C.

### Structured log

Tail persisted records for one run:

```bash
jarvis tui log 7f3a9c2e-4b1d-4e8a-9f0c-1a2b3c4d5e6f
```

Interactive ink follow: one line per record with `seq`, `kind`, and
per-kind fields (`attemptId`, `outcomeKind`, `loopOutcomeKind`, etc.).

Non-interactive replay + follow:

```bash
jarvis run log 7f3a9c2e-4b1d-4e8a-9f0c-1a2b3c4d5e6f
```

One compact JSON object per line per persisted record.

### List all runs

```bash
jarvis run list
```

Tab-separated rows:

```
7f3a9c2e-4b1d-4e8a-9f0c-1a2b3c4d5e6f  your-project  your/feature-branch  in-progress  live  -  -  -
```

Columns: `runId`, `project`, `branch`, `status`, liveness, then optional
`error.reason`, `error.retryable`, `error.nextAction` (each `-` when absent).

## Steer

Steering commands target the run ID from `jarvis run start`. They work on
ad-hoc (`run start`) runs while the loop is live.

Pause at the next iteration boundary:

```bash
jarvis run pause 7f3a9c2e-4b1d-4e8a-9f0c-1a2b3c4d5e6f
```

```
paused 7f3a9c2e-4b1d-4e8a-9f0c-1a2b3c4d5e6f
```

Abort immediately (durable `killed`, dirty worktree):

```bash
jarvis run kill 7f3a9c2e-4b1d-4e8a-9f0c-1a2b3c4d5e6f
```

```
killed 7f3a9c2e-4b1d-4e8a-9f0c-1a2b3c4d5e6f
```

Block until the next invocation boundary:

```bash
jarvis run wait 7f3a9c2e-4b1d-4e8a-9f0c-1a2b3c4d5e6f
```

Example completion:

```json
{"runStatus":"completed","loopOutcomeKind":"complete","iterationsConsumed":3,"resumable":false}
```

**Ad-hoc resume limit:** `jarvis run resume <run-id>` on a paused ad-hoc run
currently returns `not_implemented: Paused run resume is not yet implemented`.
Do not expect a pause→resume happy path here. Workflow-started paused write
steps resume through the daemon — see [`daemon-host.md`](./daemon-host.md).

## Draft PR output

When the write loop finishes with `complete`, publication runs once: commit, then
push + draft PR. Details in [`write-behavior.md`](./write-behavior.md#write-behavior).

**Completion commit** — single `jarvis: complete run` commit on the feature
branch:

```
jarvis: complete run

Spec: v2/spec/your-spec/index.md

Jarvis-Agent: claude
```

`Jarvis-Agent` names the binding that produced the final successful iteration.

**Draft PR** — `gh pr create --draft` with title `jarvis: complete run` and body:

```
Spec: v2/spec/your-spec/index.md
```

v2 does not render a v1-style per-commit attribution footer on the PR body.

**Finding the branch and PR**

- Branch: the `--branch` value you passed to `jarvis run start`, checked out in
  `~/.jarvis/worktrees/<project>/<branch>/` and pushed to `origin`.
- PR: `gh pr list --head your/feature-branch` or the URL printed by `gh` when
  the draft was created.

If `gh` auth or `origin` is missing, the run can still reach `completed` locally
but publication fails with a retryable `completion_commit_failed` operator error
on `list` / `wait`; fix prerequisites and use `jarvis run resume <run-id>` to
retry publish without a duplicate commit.

## Split an intent seed

The split-only preset (`intent`) accepts either a file seed or inline text and sends one
workflow start request after local validation:

```bash
jarvis run workflow intent --seed path/to/seed.md
jarvis run workflow intent --seed-text "Add a safer checkout flow"
```

`--seed` wins only when it is the sole seed flag; the two forms are mutually
exclusive. File seeds must remain inside the registered project after symlink
resolution. `--target-dir` is relative and non-traversing. Output is written
to `<targetDir>/ready-intents/` for git-enabled runs, or to
`~/.jarvis/specs/<project-safe-id>/ready-intents/` when git publication is
disabled. One seed produces one or more validated intent files; a single
intent remains a valid result. The raw seed remains in place.

Git-enabled runs use `intent/<slug>` in a Jarvis worktree and the resolved
remote default branch for both the worktree base and PR base. Completion first
validates and lands the complete staged set, then makes one completion commit,
pushes, and opens or reuses only an open draft PR with the matching base. A
non-fast-forward push is a publication failure: local state is retained and
the operator should resolve the remote divergence, then resume. Closed or
wrong-base PRs are never reused.

Git-disabled runs do not create a branch, worktree, commit, push, or PR. They
complete locally after landing the durable files and print their paths. A
validation or landing failure retains staging for retry without another model
invocation; resume retries the completion boundary atomically.

See [`workflow-runner.md`](./workflow-runner.md) for the runner contract and
publication ordering.

## Review an intent seed

The reviewed intent preset (`intent-reviewed`) is the recommended operator workflow
for v2 intent generation. It composes split + review, accepting the same seed flags as the split preset:

```bash
jarvis run workflow intent-reviewed --seed path/to/seed.md
jarvis run workflow intent-reviewed --seed-text "Add a safer checkout flow" --review-passes 2
```

The `--review-passes` flag (optional, defaults to `1`) controls the critic-actuator review cycle count.
Passing `--review-passes 0` is equivalent to the split-only preset (skips review).

**Outputs and failure boundary:**

- **Successful review → published intents:** After the critic validates and
  actuator lands intents successfully, the workflow publishes landed intent files
  to `<targetDir>/ready-intents/` (git-enabled) or `~/.jarvis/specs/<project-safe-id>/ready-intents/`
  (git-disabled), making them part of the durable output.
- **Review failure:** If either the critic or actuator encounters a role failure,
  the workflow stops at the review step. No intents are published. The working tree
  is reverted to post-split state and the verdict file retained for inspection.
  Resume retries review without re-splitting; resume does not re-publish if review
  had previously succeeded.

**Zero-pass escape hatch:**

To bypass review and use split-only, pass `--review-passes 0`:

```bash
jarvis run workflow intent-reviewed --seed path/to/seed.md --review-passes 0
```

This publishes the split output directly without invoking the critic or actuator.

See [`workflow-runner.md`](./workflow-runner.md) for the runner contract and
publication ordering.

## Related docs

- [`daemon-host.md`](./daemon-host.md) — IPC methods, `list`/`wait` error shape, resume semantics
- [`workflow-runner.md`](./workflow-runner.md) — multi-step workflows and the `implement` preset
