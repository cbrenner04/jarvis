# jarvis

Jarvis is a TypeScript/Bun harness for running coding-agent CLIs (`claude`, `codex`, `cursor`, `opencode`) against Markdown specs. It does not implement an agent itself: it prepares the repo, invokes one configured CLI at a time, classifies the outcome deterministically, and handles the git/GitHub bookkeeping around each successful step.

One engine ships: **`jarvis`** — daemon-backed, with durable runs in SQLite, workflow presets, configured pipelines, a live TUI, and kill/resume steering. The retired first engine is frozen under `v1/` for reference only (see [v1/README.md](v1/README.md)).

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
```

The shim runs `bun src/cli.ts` from this checkout, so keep the checkout at a stable path. If `/usr/local/bin` is not writable, symlink into another `PATH` directory such as `~/.local/bin`.

From a target repo's Git worktree root, run `jarvis init --profile <name>` to configure this machine and register the project (see [Configuration](#configuration)); re-run with `--check` any time to verify readiness.

## `jarvis`

The engine: a host-agnostic write loop, a long-running daemon, durable run state in SQLite (`orchestrationStorePath()`), Unix-socket IPC, workflow presets, review behaviors, draft-PR publication, cleanup, and an ink TUI are all implemented. Remaining gaps are listed under [Status](#status).

### Configuration

`jarvis init --profile <name>` is the primary setup and preflight command: run from the target repo's Git worktree root, it bootstraps `agents` and `machineProfile`, registers the current repo, and reports readiness. Safe to re-run any time; `--check` reports readiness without writing. Full flag reference and merge semantics: [docs/install-and-config.md](docs/install-and-config.md).

Jarvis splits configuration into two layers, still hand-editable as the underlying reference:

- `~/.jarvis/config.json` (per machine): `agents` — the ordered agent
  fallback chain, hand-edited (`jarvis init` seeds it) — plus a required
  `machineProfile` selector and an optional `projects` registry.
- `config/machines/<profile>.json` (committed): the role→model store mapping
  each `(agent, role)` pair to an ordered list of model rungs. Profiles
  `home` and `work` are seeded.

Both loops — outer agent order, inner rung escalation — advance on quota exhaustion only; model-config errors are terminal. See [docs/agent-model-config.md](docs/agent-model-config.md) and [docs/role-resolution.md](docs/role-resolution.md).

### Quickstart

```sh
jarvis init --profile home
jarvis daemon start
jarvis run start --project-root <repo> --project <label> --branch <branch> \
  --base main --spec <spec-path> --artifact <artifact-path>
jarvis tui
```

`run start` prints a run ID. Observe with `jarvis tui`, `jarvis run list`, `jarvis run log <id>`, or `jarvis daemon log --follow`; steer with `jarvis run kill|resume|wait <id>`. For detached work, configure `notificationSinkCommand` in `~/.jarvis/config.json` so the daemon pushes pipeline gates and terminal boundaries instead of polling `run list` — see [docs/operator-runbook.md](docs/operator-runbook.md#operator-notifications). On completion the run commits, pushes, and opens a draft PR with a `Jarvis-Agent:` attribution footer. Full happy path: [docs/first-workflow-walkthrough.md](docs/first-workflow-walkthrough.md).

Workflow presets:

```sh
jarvis run workflow intent --seed <path> [--review-passes <n>] [--review-behavior debate|light]
jarvis run workflow plan --ready-intent <path> [--target-dir <dir>] [...]
jarvis run workflow implement --base main --spec <index.md> [--branch <name>] [...]
```

### Commands

```text
jarvis init [--profile <name>] [--name <key>] [--target-dir <dir>] [--scaffold] [--check]
                            Configure this machine and register the current
                            repository; reports readiness. `--check` is read-only.
jarvis daemon start|stop|status|log [--follow]
jarvis run start ...        Daemon-backed write loop; prints run ID.
jarvis run list             One row per run: id, project, branch, status,
                            liveness, error, worktree.
jarvis run log <run-id>     Stream persisted structured records as JSON lines.
jarvis run resume|kill|wait <run-id>
jarvis run workflow intent|plan|implement ...
jarvis tui [log <run-id>]   Live ink monitor / per-run log follow.
jarvis cleanup [<project>] [--dry-run] [--yes|-y] [--abandon <name> [--discard-unlanded]]
                            Retire merged worktrees; archive completed specs. `<project>` and `--abandon <name>` are mutually exclusive.
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

Not yet: resuming a paused _ad-hoc_ run (workflow-started steps do resume), per-invocation `--agent`/`--model` overrides, the local-model terminal fallback, and the natural-language prompt router (`jarvis "<intent>"`).

### Documentation

- [docs/vision.md](docs/vision.md) — vision and constraints: guiding
  principles and architectural constraints.
- [docs/architecture.md](docs/architecture.md) — layered model,
  workflows, IPC, runs and state, git/PRs.
- [docs/install-and-config.md](docs/install-and-config.md) — install,
  configure, daemon lifecycle, recovery.
- [docs/first-workflow-walkthrough.md](docs/first-workflow-walkthrough.md)
  — end-to-end happy path to a completed run and draft PR.
- [docs/agent-model-config.md](docs/agent-model-config.md) — agent order
  vs. role→model store, rung escalation, validation.
- [docs/role-resolution.md](docs/role-resolution.md) — role taxonomy and
  step→role binding.
- [docs/workflow-runner.md](docs/workflow-runner.md) — multi-step
  execution, presets, resume.
- [docs/daemon-host.md](docs/daemon-host.md) — daemon internals, IPC,
  steering.
- [docs/state-store.md](docs/state-store.md) — SQLite schema and
  persistence contract.

## v1 (frozen)

`v1/` holds the retired first engine — source, tests, specs, and docs — frozen at tag `v1-final` for reference. It is not compiled, tested, linted, or linked, and `bin/jarvis1` no longer exists; contributors treat it as read-only history. See [v1/README.md](v1/README.md).

Agents working in this repository should also read [AGENTS.md](AGENTS.md).

## Hit a harness gap?

Found friction using Jarvis on another repo? [Submit a harness suggestion](https://github.com/cbrenner04/jarvis/issues/new/choose).

## Development

TypeScript on Bun with strict compiler settings and Biome.

Checks: `bun run typecheck`, `bun run lint`, `bun run check`, and `bun run lint:md` (markdownlint over `docs`, `spec`, `reports`, and root docs). Repair soft-wrapped authored markdown with `bun run reflow:md` (same corpus scope). Fixes: `bun run format`, `bun run lint:fix`, `bun run check:fix` (plus `:unsafe` variants — inspect their diffs).

Tests are scoped by surface: `bun run test` (all), `test:agent`, `test:integration`, `test:shared`, `test:integration:shared`. Per-test timeout is 30 s via `bunfig.toml`; pass `{ timeout: <ms> }` only when a test legitimately needs more.

Before moving a PR out of draft:

```sh
bun run ready
```

`ready` runs install (when required), `check`, `typecheck`, `test`, and `lint:md`, each under its own fixed step budget, with a 45-minute overall run ceiling as backstop (override with `JARVIS_READY_TIMEOUT_MS`); on timeout it kills the process tree and exits 124. `JARVIS_READY_TIER=fast` runs just `typecheck` + `test`.
