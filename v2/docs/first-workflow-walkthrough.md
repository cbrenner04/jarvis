# First workflow walkthrough

One happy path from prerequisites through a completed run and its draft PR.
This is not a command reference — see [`write-behavior.md`](./write-behavior.md) for
CLI contracts and [`daemon-host.md`](./daemon-host.md) / [`workflow-runner.md`](./workflow-runner.md)
for IPC and workflow internals.

## Common review semantics

Intent, plan, and implement reviews use the same light or debate cycle. A light
review runs critic then actuator for a non-empty verdict; debate runs adversary,
advocate, adjudicator, then actuator. The selected profile supplies prompts,
verdict handling, boundaries, and the existing workflow-worktree cwd. Reviewed
intent retains diagnostics and resumes landing without rerunning roles; plan
keeps its in-tree verdict, while implement protects the completed spec tree.

The walkthrough uses an ad-hoc `jarvis run start` run (direct write mode) so live
`pause` and `resume` are exercised on the active run. Workflow-started implement
supports live `kill` but not `pause`/`resume` — see
[Workflow-started implement](#workflow-started-implement).

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

## Start a run

Launch an ad-hoc write loop against your spec. This mutating dispatch command
automatically starts or reuses the daemon keyed by the invoking executable
(identified by its content digest). The daemon is addressable over a keyed socket
in `~/.jarvis/` and remains available for subsequent `jarvis` invocations from
the same binary. Every flag below is required except `--max-iterations`:

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
  (`live` / `not-live`). `status` and `liveness` are colored by run-state
  semantics (active cyan, completed green, terminal failure red; `not-live`
  uncolored); text labels remain the primary signal. Rows list active runs first
  (newest first), then terminal history (newest first); daemon order is
  preserved within each group. The selected row is marked with `>`. On entry
  the topmost active run is selected and a daemon `wait` is issued for it; when
  every run is terminal, selection falls to the first terminal row.
- **Queue** (when present) — FIFO rows waiting for memory headroom.
- **Outcome** — from daemon `wait` for the selected run: `runStatus` plus
  optional `loopOutcomeKind`, `iterationsConsumed`, and `resumable`. Shows
  `Waiting for <run-id>...` while `wait` is pending.
- **Steering feedback** — inline `<code>: <message>` after a steering RPC
  failure, triggered by the interactive keys below.

Keys act on the selected run: `k` kills any live run.

Move selection with Up/Down arrow keys or `j` (down only). Movement clamps at
the first and last selectable run-table rows, skips Queue rows, re-issues daemon
`wait` for the new selection, and resets Outcome to its pending state.

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

A harness failure mid-workflow (uncaught `executeWorkflow` rejection after a
step's run row exists) ends the affected run with a terminal `run_execution_failed`
record carrying the error `message`, durable `failed`, and `not-live` on `list` —
not a run stuck `in-progress` with no terminal signal.

### Invocation session logs

When a run stalls or fails before structured records accrue, read the on-disk
invocation session log for the active iteration:

```bash
ls -t ~/.jarvis/sessions/<run-id>-*.log | head -1 | xargs cat
```

Each write-loop iteration opens `~/.jarvis/sessions/<run-id>-<timestamp>.log`
(millisecond, filesystem-safe timestamp). Lines use the same `[tag]` transcript
format as v1 (`harness`, `outbound`, `inbound_stdout`, `inbound_stderr`). The
loop stamps run/spec/iteration before spawn and `outcome=…` at settle. A stalled
invocation may have harness + outbound only — no `inbound_*` until the binding
settles. Structured `jarvis run log` records remain the durable run timeline once
they exist.

### Nothing is happening

Read the detached daemon's stdout/stderr separately from a run's structured
records:

```bash
jarvis daemon log --follow
```

This reads `~/.jarvis/daemon.log` directly and works even when the daemon is
not running. Use `jarvis run log <run-id>` or `jarvis tui log <run-id>` for
structured records belonging to one run.

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

**Draft PR** — `gh pr create --draft` with title extracted from the spec's `index.md`
H1 heading (falling back to `jarvis: complete run` when unresolvable) and body:

```
Spec: v2/spec/your-spec/index.md

## Subspecs
- 00 - Safer checkout — Prevents unsafe checkout state.

## Commits
- implement safer checkout

## Change summary
2 files changed (+18/-4)

- v2/src: 1 file (+15/-3)
- v2/test: 1 file (+3/-1)
```

Plan and implement PR bodies contain the deterministic template after `Spec:`:
linked subspec why lines, branch commit subjects, risk cues, and a diff summary.
The template is regenerated on each publication retry; plain narrative markers
and the attribution footer remain around it. Intent PRs retain their landed-file
summary.

### Finding the branch and PR

- Branch: the `--branch` value you passed to `jarvis run start`, checked out in
  `~/.jarvis/worktrees/<project>/<branch>/` and pushed to `origin`.
- PR: `gh pr list --head your/feature-branch` or the URL printed by `gh` when
  the draft was created.

If `gh` auth or `origin` is missing, the run can still reach `completed` locally
but publication fails with a retryable `completion_commit_failed` operator error
on `list` / `wait`; fix prerequisites and use `jarvis run resume <run-id>` to
retry publish without a duplicate commit.

## Session close-out

After the implementation PR lands, run `jarvis cleanup --dry-run`, then confirm
`jarvis cleanup`. It retires the merged worktree and local branch, archives the
completed v2 spec under `v2/spec/completed/`, and prunes its ready-intent only
when it byte-matches `intent.md`. Durable run history remains available; incomplete,
open-PR, or worktree-owned specs remain in place with a refusal reason.

## Optional daemon lifecycle control

The daemon starts automatically on the first mutating dispatch invocation
(e.g., `jarvis run start` or `jarvis run workflow implement`). Manual daemon
control is optional and useful for lifecycle management only:

```bash
jarvis daemon start
```

On success stdout is compact JSON with the child PID and socket key:

```json
{"pid":12345,"socketKey":"...hash..."}
```

Confirm health with:

```bash
jarvis daemon status
```

Stop the daemon (or a specific instance by key):

```bash
jarvis daemon stop
```

Daemon shutdown is automatic on logout or machine shutdown; manual invocation is
rarely needed.

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
intent remains a valid result. A successful file-seed promotion consumes that
seed; inline seeds have no source artifact. Failures retain file seeds for retry.

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

The canonical intent workflow optionally composes split + review:

```bash
jarvis run workflow intent --seed path/to/seed.md --review-passes 1 --review-behavior light
jarvis run workflow intent --seed-text "Add a safer checkout flow" --review-passes 2 --review-behavior debate
```

The uniform `--review-passes` and `--review-behavior` flags apply to intent,
plan, and implement with preset-specific defaults. Omitted passes run one light
review for `intent` and one debate review for `plan`. `--review-behavior`
selects `debate` or `light` when passes are positive. Passing
`--review-passes 0` skips review.

Review runs entirely in the split workspace: critic and actuator invocations,
verdict handling, staging, durable landing, and Git publication never modify the
operator checkout.

**Outputs and failure boundary:**

- **Successful review → published intents:** After the critic validates and
  actuator lands intents successfully, the workflow publishes landed intent files
  to `<targetDir>/ready-intents/` (git-enabled) or `~/.jarvis/specs/<project-safe-id>/ready-intents/`
  (git-disabled), making them part of the durable output. Git-enabled output is
  committed, pushed, and published through its draft PR; git-disabled output has
  no Git or GitHub publication.
- **Review failure:** If either the critic or actuator encounters a role failure,
  the workflow stops at the review step. No intents are published. The working tree
  is reverted to post-split state and the verdict file retained for inspection.
  A landing failure records a resumable landing cause and retains the staged output
  and verdict. Resume retries landing without re-running critic or actuator.

**Zero-pass escape hatch:**

To bypass review and use split-only, pass `--review-passes 0`:

```bash
jarvis run workflow intent --seed path/to/seed.md --review-passes 0
```

This publishes the split output directly without invoking the critic or actuator.

See [`workflow-runner.md`](./workflow-runner.md) for the runner contract and
publication ordering.

## Draft and review a plan ready-intent

The canonical `plan` workflow drafts a spec tree from a ready-intent, then
runs one debate review cycle by default over the materialized draft:

```bash
jarvis run workflow plan --ready-intent spec/ready-intents/my-feature.md
jarvis run workflow plan --ready-intent spec/ready-intents/my-feature.md --review-passes 2 --review-behavior debate
```

For a lighter critic-actuator pass, use `plan-reviewed-light` or pass
`--review-behavior light`:

```bash
jarvis run workflow plan-reviewed-light --ready-intent spec/ready-intents/my-feature.md
jarvis run workflow plan --ready-intent spec/ready-intents/my-feature.md --review-behavior light
```

Omitted `--review-passes` is one debate pass for `plan`. Pass
`--review-passes 0` for draft-only (no review step); that is not equivalent
to bare `plan`. Invalid pass
counts (`1x`, `-1`, `1.5`, and similar) and invalid `--review-behavior` values are rejected
before daemon contact.

On successful review, the actuator's edits land in the drafted spec tree and
the critic verdict is persisted at `<spec-dir>/verdict-plan.md` inside the
published spec directory.

See [`workflow-runner.md`](./workflow-runner.md) for preset composition and
[`write-behavior.md`](./write-behavior.md) for the light review rendering contract.

## Workflow-started implement

The implement workflow preset launches a write loop against an `index.md` spec.
Live `pause` and `resume` remain unsupported on workflow-started rows; live
`kill` uses the same `jarvis run kill <run-id>` contract as ad-hoc runs (see
[`daemon-host.md` § Live controls](./daemon-host.md#live-controls-on-workflow-started-runs)).
Review runs by default (one debate pass); pass
`--review-passes 0` to skip it. Like `jarvis run start`, this command
automatically starts or reuses the daemon keyed by the invoking executable.

```bash
jarvis run workflow implement \
  --base main \
  --spec v2/spec/your-spec/index.md
```

| Flag | Meaning |
| --- | --- |
| `--base` | Base git ref for the worktree |
| `--spec` | Spec path (typically `index.md`); must exist inside the registered project after symlink resolution |
| `--branch` | Optional; defaults to the parent directory basename of `--spec` |
| `--artifact` | Optional for `index.md` (ignored if supplied); required for non-index specs |
| `--review-passes` | Optional non-negative integer; overrides `projects.<key>.implement.reviewPasses` (default `1`; pass `0` to skip review) |
| `--review-behavior` | Optional `debate` or `light`; overrides `projects.<key>.implement.reviewBehavior` (default `debate`). Applies only when resolved review passes are positive. |

Before daemon contact or worktree creation, implement resolves the registered root,
spec, and effective artifact through symlinks and requires the resolved paths to
remain inside that root. Non-index artifacts must exist; index launches use the
spec as the artifact and ignore `--artifact`. The validated paths are made
project-relative and consumed inside the created worktree, so first launch reads
the source checkout rather than requiring the future worktree to exist. Malformed
pass counts (`1x`, `-1`, `1.5`, and similar), unknown `--review-behavior` values,
and invalid project `implement.reviewPasses` or `implement.reviewBehavior` values
also fail before daemon contact.

An already-complete spec tree does not start a workflow: the command exits `1`
with `implement.already_complete`, prints no run ID, and creates neither a
worktree nor a run row. Complete the next unchecked non-human-only criterion or
choose an incomplete spec before retrying.

The CLI sends one IPC `start` request and prints the run ID on stdout:

```
7f3a9c2e-4b1d-4e8a-9f0c-1a2b3c4d5e6f
```

Observe the run with `jarvis tui` or `jarvis run log <run-id>`. Abort a live
workflow implement step immediately (durable `killed`, dirty worktree):

```bash
jarvis run kill <run-id>
```

`pause` and `resume` are not supported on workflow-started implement rows.

See [`write-behavior.md`](./write-behavior.md#run-control-cli) for the full CLI
contract and [`workflow-runner.md`](./workflow-runner.md) for workflow composition.

Publication writes first use `.jarvis-intent-stage` or `.jarvis-plan-stage`.
After writing (and review, when configured), the selected landing hook validates
and atomically moves durable output. Collisions and filesystem failures leave
staging for retry; durable destinations are ready-intents for intents and the
precomputed spec tree for plans. A successful intent or plan consumes its queue
input only after landing; Git commits include the mapped queue deletion, while
no-Git runs delete the source after the durable output exists. Draft, review,
validation, collision, and publication failures retain queue inputs. Completion
publication runs only after landing.

## Configured pipeline (`jarvis pipeline start`)

Use a **configured pipeline** when the project registry names a pipeline definition
in `projects.<name>.pipeline` (for example `full-review` with `terminalAction:
"ready"`). Registration requires `projects.<name>.root` in `~/.jarvis/config.json`
(see [`install-and-config.md`](./install-and-config.md)). The pipeline walks
ordered workflow and approval stages; the daemon persists stage state, handles
failure resume, and settles the configured terminal action after every stage
succeeds.

**When to use pipeline vs direct `run start`:** `jarvis run start` runs one ad-hoc
write loop against a spec you name on the CLI. `jarvis pipeline start <project>`
admits the project's configured definition (intent → gates → plan → gates →
implement for `full-review`) with a seed (`--seed-text` or `--seed`). Use pipeline
when you want the full review-and-approval choreography and terminal `ready`
settlement; use `run start` for a single spec iteration without pipeline stages.

**Prerequisites for `full-review`:** registered project with
`projects.<name>.pipeline` set to `{ "name": "full-review", "terminalAction":
"ready" }`, machine profile and agent bindings configured, git repo with `origin`,
and `gh auth status` succeeding (terminal `ready` settlement gates on GitHub).

**Start and observe:**

```bash
jarvis pipeline start demo --seed-text "Ship feature"
# or detached: jarvis pipeline start demo --seed-text "Ship feature" --detach

jarvis pipeline list
jarvis pipeline wait <pipeline-id>
```

**Approval gates:** when `pipeline wait` prints `{kind:"awaiting-approval",stageId}`,
approve the named gate (`approve-intent`, then `approve-plan` on `full-review`):

```bash
jarvis pipeline approve <pipeline-id> <stage-id>
jarvis pipeline wait <pipeline-id>
```

**Failure resume:** after a failed workflow stage (for example `plan`), reopen
without a new admission:

```bash
jarvis pipeline resume <pipeline-id>
jarvis pipeline wait <pipeline-id>
```

Resume replays from the failed stage; succeeded predecessors keep their
`workflowInvocationId`. Re-approve any gate that returns to `awaiting` before
the walk continues.

**Terminal `ready` settlement:** when every workflow stage and approval gate has
succeeded, the daemon runs terminal publication for `terminalAction: "ready"` (gate
then flip draft PR to ready). Derived pipeline state stays `running` until
settlement finishes; then `derivePipelineState` is `succeeded` and
`terminalPublicationSucceededAt` is set. Pair `pipeline wait` or `pipeline list`
with attached `pipeline start` to observe the terminal boundary.

**Inter-stage handoff:** workflow stages hand off through durable stage
artifacts recorded on each stage's entry-run worktree. Merging intent or plan
PRs to `main` between stages is not required for the next stage to resolve its
inputs. Approval gates are continue/stop checkpoints only — they do not merge
or rewrite artifact paths between stages.

## Related docs

New plan and implement PRs use the spec's first non-empty `index.md` H1. A
heading-less readable index uses its directory basename; a non-index spec uses
its file basename even when a sibling index exists. Intent and reviewed-intent
PRs retain `intent: <name>`. Missing or unreadable index identity fails with a
named title-resolution error, with no generic completion title.

- [`daemon-host.md`](./daemon-host.md) — IPC methods, `list`/`wait` error shape, resume semantics
- [`workflow-runner.md`](./workflow-runner.md) — multi-step workflows and the `implement` preset
