# jarvis

Jarvis is a TypeScript/Bun harness for running coding-agent CLIs (`claude`, `codex`, `cursor`, `opencode`) against Markdown specs. It does not implement an agent itself: it prepares the repo, invokes one configured CLI at a time, classifies the outcome deterministically, and handles the git/GitHub bookkeeping around each successful step.

Two engines ship side by side:

- **`jarvis` (v2)** — the primary engine. Daemon-backed: durable runs in
  SQLite, workflow presets, a live TUI, pause/kill steering.
- **`jarvis1` (v1)** — the maintenance-only fallback, kept green with no new
  investment; covers the original pipeline (intent → plan → run → review →
  triage).

Both engines read the shared top-level `prompts/` tree, so prompt improvements land in both.

## Installation

Prerequisites:

- [Bun](https://bun.sh/)
- [GitHub CLI](https://cli.github.com/) (`gh`) installed and authenticated
- At least one supported agent CLI on `PATH`: `claude`, `codex`, `cursor`, or
  `opencode`

Install from a local checkout:

```sh
git clone <this-repo-url> ~/code/jarvis
cd ~/code/jarvis
bun install
ln -s ~/code/jarvis/bin/jarvis /usr/local/bin/jarvis
ln -s ~/code/jarvis/bin/jarvis1 /usr/local/bin/jarvis1
```

The shims run `bun v2/src/cli.ts` and `bun v1/src/cli.ts` from this checkout, so keep the checkout at a stable path. If `/usr/local/bin` is not writable, symlink into another `PATH` directory such as `~/.local/bin`.

## v2 (`jarvis`)

v2 is the primary engine: a host-agnostic write loop, a long-running daemon, durable run state in SQLite (`~/.jarvis/state/v2.sqlite`), Unix-socket IPC, workflow presets, review behaviors, draft-PR publication, cleanup, and an ink TUI are all implemented. Remaining gaps are listed under [Status](#status).

### Configuration

v2 splits configuration into two layers:

- `~/.jarvis/config.json` (per machine): `agents` — the ordered agent
  fallback chain, edited via `jarvis config set-agents` — plus a required
  hand-edited `machineProfile` selector and an optional `projects` registry.
- `config/machines/<profile>.json` (committed): the role→model store mapping
  each `(agent, role)` pair to an ordered list of model rungs. Profiles
  `home` and `work` are seeded.

Both loops — outer agent order, inner rung escalation — advance on quota exhaustion only; model-config errors are terminal. See [v2/docs/agent-model-config.md](v2/docs/agent-model-config.md) and [v2/docs/role-resolution.md](v2/docs/role-resolution.md).

### Quickstart

```sh
jarvis config set-agents claude,codex,cursor
# hand-edit ~/.jarvis/config.json to add "machineProfile": "home"
jarvis daemon start
jarvis run start --project-root <repo> --project <label> --branch <branch> \
  --base main --spec <spec-path> --artifact <artifact-path>
jarvis tui
```

`run start` prints a run ID. Observe with `jarvis tui`, `jarvis run list`, `jarvis run log <id>`, or `jarvis daemon log --follow`; steer with `jarvis run pause|kill|wait <id>`. On completion the run commits, pushes, and opens a draft PR with a `Jarvis-Agent:` attribution footer. Full happy path: [v2/docs/first-workflow-walkthrough.md](v2/docs/first-workflow-walkthrough.md).

Workflow presets mirror the v1 pipeline stages:

```sh
jarvis run workflow intent --seed <path> [--review-passes <n>] [--review-behavior debate|light]
jarvis run workflow plan --ready-intent <path> [--target-dir <dir>] [...]
jarvis run workflow implement --base main --spec <index.md> [--branch <name>] [...]
```

### Commands

```text
jarvis write ...            In-process ad-hoc write loop (no daemon); same
                            flags as `run start`; prints a JSON result.
jarvis daemon start|stop|status|log [--follow]
jarvis config show|path|set-agents <csv>
jarvis run start ...        Daemon-backed write loop; prints run ID.
jarvis run list             One row per run: id, project, branch, status,
                            liveness, error, worktree.
jarvis run log <run-id>     Stream persisted structured records as JSON lines.
jarvis run pause|resume|kill|wait <run-id>
jarvis run workflow intent|plan|implement ...
jarvis tui [log <run-id>]   Live ink monitor / per-run log follow.
jarvis cleanup [--abandon] [--dry-run] [<name>]
                            Retire merged v2 worktrees; archive completed
                            v2 specs.
jarvis help                 List top-level commands.
jarvis --version
```

### Vocabulary

- **Workflow** — a named, mostly-linear array of steps with bounded loops.
- **Step** — the reusable unit; binds a behavior, a prompt, and a role.
- **Behavior** — the loop primitive a step runs: `write`, `review`,
  `review-debate`.
- **Role** — the model-resolution key (`plan`, `implement`, `shrink`,
  `adversary`, `critic`, `advocate`, `adjudicator`, `actuator`).
- **Rung / binding** — one `(adapterModel, priceKey)` entry; the resolved
  `(agent, model)` an invocation actually runs.
- **Outcome** — the deterministic classification the runner branches on
  (`done`, `progress`, `blocked`, `contract_miss`, ...).
- **Run** — one durable orchestration record in SQLite, with lifecycle status
  (`in-progress`, `queued`, `paused`, `completed`, `failed`, `killed`, ...)
  distinct from liveness.

### Status

Implemented: write loop, daemon host with restart reconciliation and memory-watermark admission, IPC, SQLite state store, structured per-run logs, workflow runner with `intent`/`plan`/`implement` presets, light and debate review behaviors, shrink pass, PR publication, TUI.

Not yet: resuming a paused _ad-hoc_ run (workflow-started steps do resume), per-invocation `--agent`/`--model` overrides, the local-model terminal fallback, and the natural-language prompt router (`jarvis "<intent>"`). Roadmap: [v2/spec/v2-meta-index.md](v2/spec/v2-meta-index.md).

### v2 documentation

- [v2/docs/v2-vision.md](v2/docs/v2-vision.md) — why v2 exists: guiding
  principles and architectural constraints.
- [v2/docs/v2-architecture.md](v2/docs/v2-architecture.md) — layered model,
  workflows, IPC, runs and state, git/PRs.
- [v2/docs/install-and-config.md](v2/docs/install-and-config.md) — install,
  configure, daemon lifecycle, recovery.
- [v2/docs/first-workflow-walkthrough.md](v2/docs/first-workflow-walkthrough.md)
  — end-to-end happy path to a completed run and draft PR.
- [v2/docs/agent-model-config.md](v2/docs/agent-model-config.md) — agent order
  vs. role→model store, rung escalation, validation.
- [v2/docs/role-resolution.md](v2/docs/role-resolution.md) — role taxonomy and
  step→role binding.
- [v2/docs/workflow-runner.md](v2/docs/workflow-runner.md) — multi-step
  execution, presets, resume.
- [v2/docs/daemon-host.md](v2/docs/daemon-host.md) — daemon internals, IPC,
  steering.
- [v2/docs/state-store.md](v2/docs/state-store.md) — SQLite schema and
  persistence contract.

## v1 (`jarvis1`)

v1 is the maintenance-only fallback pipeline: size work with `intent`, draft specs with `plan`, implement with `run`, then post-completion shrink and review passes flip the draft PR to ready. Specs are ordinary Markdown; work is complete when the active spec has no unchecked task-list items.

### Quickstart

Register the target repo once:

```sh
cd <target-repo>
jarvis1 init
```

Split a raw seed into reviewable intents, then plan one:

```sh
jarvis1 intent "Add a settings toggle for dark mode"
# review + merge the intent PR, then:
jarvis1 plan spec/ready-intents/<name>.md
```

Plan mode drafts `spec/YYYY-MM-DDTHH-mm-ssZ-<name>/` (index + atomic subspecs) on a `plan/<name>` branch, opens a draft PR, runs self-review passes, and flips the PR ready when everything is green. Review and merge it before implementation.

Run the implementation loop (the log server must be up):

```sh
jarvis1 log-server
# in another terminal
jarvis1 run spec/YYYY-MM-DDTHH-mm-ssZ-<name>/index.md
```

`jarvis1 run` creates or resumes `.worktree/<spec-name>/`, invokes agents from `modes.patch.agentOrder` with quota fallback, commits each completed subspec, pushes, and maintains a draft PR. After the checklist completes, a gated pipeline runs: full ready gate → shrink pass → review passes (`modes.review.passes`) → guarded draft→ready flip. Jarvis never merges PRs.

### Spec shape

```text
spec/YYYY-MM-DDTHH-mm-ssZ-my-feature/
  index.md          # routing checklist of subspec pointers
  intent.md
  00-first-task.md
  01-second-task.md
```

Each subspec carries a `## Acceptance criteria` checklist; the agent ticks only the criteria it satisfied, and Jarvis uses those checkbox transitions to decide commit, `WIP:` progress commit, no-progress stop, or blocker stop. Authoring contract: [v1/docs/spec-guidance.md](v1/docs/spec-guidance.md).

### Commands

```text
jarvis1 run [--max-iterations <n>] [--review-passes <n>] [--tier trivial|standard|hard]
        [--agent <name>[:<model>]] [--repo <name|path|url>] [--cwd <dir>]
        [--resume-review] <spec-path>
    Implement an existing spec. `--cwd` requires git: false. `--resume-review`
    re-enters post-completion review on an already-complete spec.

jarvis1 intent [--agent <name>[:<model>]] [--repo ...] [--target-dir <dir>]
        <raw-seed-file|"inline text">
    Split one seed into authored intents under <targetDir>/ready-intents/ and
    open a PR for split review.

jarvis1 plan [--review-passes <n>] [--agent <name>[:<model>]] [--repo ...]
        [--target-dir <dir>] <targetDir>/ready-intents/<name>.md
    Draft a spec tree from a ready intent, then self-review.
    `--resume <index.md>` runs more review passes on an existing plan branch;
    `--recover <relative-subspec> <index.md>` splits an oversized subspec out.

jarvis1 prompt [--repo ...] [--agent <name>[:<model>]] [--model <model>] <text>
    Single-pass agent run in a registered project.

jarvis1 init
    Register the current repo; scaffold OPERATOR_RUNBOOK.md if absent.

jarvis1 config
    Show or edit config: show, path, projects, set-patch-order,
    set-plan-order, set-prompt-order, set-git, set-project-git,
    remove-project, edit.

jarvis1 prices
    Show or edit model pricing data used for cost summaries.

jarvis1 log-server
    Start the local full-transcript log server required by `jarvis1 run`.

jarvis1 cleanup [--abandon] [--dry-run] [<worktree-name>]
    Remove merged worktrees and branches, archive matching specs under
    spec/completed/. `--abandon` retires abandoned worktrees.

jarvis1 triage [target] [--mark-ready] [--merge]
    Inspect dirty or orphaned worktrees. `--mark-ready` commits dirty work and
    flips the PR ready on a green gate; `--merge` (worktree, spec path, or PR
    ref) waits for green CI then admin-squash-merges.

jarvis1 review-feedback <worktree-name>
    Address PR review feedback on an existing patch worktree.

jarvis1 runbook add [--section <heading>] [--issue-url <url>] <entry>
    Append a learning to the project OPERATOR_RUNBOOK.md.

jarvis1 help
    Show CLI usage.
```

### Configuration

State lives under `~/.jarvis/` (`config.json`, `runs.jsonl`, `sessions/`, `specs/`). Config version 2 gives each mode its own agent order:

```json
{
  "version": 2,
  "modes": {
    "patch": {
      "agentOrder": [
        { "agent": "claude", "model": "haiku" },
        { "agent": "codex", "model": "gpt-5.3-codex" },
        { "agent": "cursor", "model": "Composer 2" }
      ],
      "shrink": "agent"
    },
    "plan": { "agentOrder": ["..."], "targetDir": "spec" },
    "review": { "passes": 2 }
  },
  "git": true,
  "quotaFallback": "lenient",
  "maxIterations": 10,
  "iterationTimeoutMs": 600000,
  "projects": {
    "my-repo": { "root": "/path/to/my-repo", "origin": "git@github.com:me/my-repo.git" }
  }
}
```

Default agent order is `claude → codex → cursor`; `opencode` is opt-in with an explicit model string. Important switches:

- `git: false` disables worktrees, commits, pushes, and PRs; the agent runs in
  the project root or `--cwd <dir>`.
- `modes.plan.commit: false` stores plan output under `~/.jarvis/specs/...`
  with no branch or PR.
- `modes.plan.targetDir` / `--target-dir` route where specs and ready-intents
  land.
- `worktreeSymlinks` symlinks paths such as `node_modules` into run worktrees.
- `projects[<name>].siblings` exposes sibling repos for multi-repo work.
- `telemetryPath: null` disables JSONL telemetry.

Full schema and validation: [v1/docs/config.md](v1/docs/config.md).

### Agents and output

One agent CLI per phase or iteration; quota exhaustion rotates to the next configured agent, model-config errors do not fall back.

- `claude` — JSON stream mode with token/cost extraction.
- `codex` — `codex exec` with workspace-write sandboxing; usage correlated
  from Codex session JSONL.
- `cursor` — headless `cursor agent`; token usage recorded as unavailable.
- `opencode` — opt-in `opencode run`; permissions via opencode's config file.

Output destinations: concise harness progress in the run terminal, full transcripts in `~/.jarvis/sessions/*.log` and the `jarvis1 log-server` viewer, per-invocation telemetry in `~/.jarvis/runs.jsonl`.

### v1 documentation

- [v1/docs/run-loop.md](v1/docs/run-loop.md) — run resolution, gated pipeline,
  review/shrink, stop conditions, exit codes.
- [v1/docs/intent-mode.md](v1/docs/intent-mode.md) — seed → ready-intents
  fan-out and the emit contract.
- [v1/docs/plan-mode.md](v1/docs/plan-mode.md) — plan phases, commit and
  no-commit modes, resume, recover.
- [v1/docs/specless-prompt.md](v1/docs/specless-prompt.md) — `jarvis1 prompt`
  semantics and exit codes.
- [v1/docs/config.md](v1/docs/config.md) — config schema, defaults, project
  registration.
- [v1/docs/agents.md](v1/docs/agents.md) — supported CLIs, exact flags, usage
  extraction, opt-in setup.
- [v1/docs/quota-signals.md](v1/docs/quota-signals.md) — quota/model/error
  classification and fallback.
- [v1/docs/worktrees-and-commits.md](v1/docs/worktrees-and-commits.md) —
  worktree layout, commits, PR bodies, cleanup, triage.
- [v1/docs/operator-runbook.md](v1/docs/operator-runbook.md) — operator
  session patterns and recovery workflows.
- [v1/docs/spec-guidance.md](v1/docs/spec-guidance.md) — spec authoring
  conventions.

Agents working in this repository should also read [AGENTS.md](AGENTS.md).

## Hit a harness gap?

Found friction using Jarvis on another repo? [Submit a harness suggestion](https://github.com/cbrenner04/jarvis/issues/new/choose).

## Development

TypeScript on Bun with strict compiler settings and Biome.

Checks: `bun run typecheck`, `bun run lint`, `bun run check`, and `bun run lint:md` (markdownlint over v1 and v2 specs, v1 and v2 docs, reports, and root docs). Repair soft-wrapped authored markdown with `bun run reflow:md` (same corpus scope). Fixes: `bun run format`, `bun run lint:fix`, `bun run check:fix` (plus `:unsafe` variants — inspect their diffs).

Tests are scoped by surface: `bun run test` (all), `test:v1`, `test:v2`, `test:integration:v2`, `test:shared`. Per-test timeout is 30 s via `bunfig.toml`; pass `{ timeout: <ms> }` only when a test legitimately needs more.

Before moving a PR out of draft:

```sh
bun run ready
```

`ready` runs install (when required), `check`, `typecheck`, `test`, and `lint:md`, each under its own fixed step budget, with a 45-minute overall run ceiling as backstop (override with `JARVIS_READY_TIMEOUT_MS`); on timeout it kills the process tree and exits 124. `JARVIS_READY_TIER=fast` runs just `typecheck` + `test`.
