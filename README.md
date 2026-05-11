# jarvis

Coding agent harness — a minimal "ralph loop" that drives an underlying agent
CLI (`claude`, `codex`, `cursor`, or `opencode`) against a Markdown spec
until every task checkbox is checked.

## Installation

Prerequisites:

- [Bun](https://bun.sh/) installed.
- [GitHub CLI](https://cli.github.com/) (`gh`) installed and authenticated
  (run `gh auth login` if needed).
- At least one supported agent CLI available on `PATH`: `claude`, `codex`,
  `cursor`, or `opencode`. See [Agents](#agents) and
  [docs/agents.md](docs/agents.md). `opencode`, `airproxy`, and `copilot`
  are supported but opt-in.

Install jarvis from a local clone:

```sh
git clone <this-repo-url> ~/code/jarvis
cd ~/code/jarvis
bun install
ln -s ~/code/jarvis/bin/jarvis /usr/local/bin/jarvis
jarvis help
```

Clone the repo to a stable path: the `jarvis` executable in `bin/` is a small
shim that runs `bun src/cli.ts` from this checkout, so moving or deleting the
checkout breaks the symlink. If `/usr/local/bin` is not writable or is not on
your `PATH`, create the symlink in another directory that is on `PATH`.

## Quickstart

From the repository you want jarvis to work on:

```sh
cd <target-repo>
jarvis init
mkdir -p spec/<name>
$EDITOR spec/<name>/index.md
```

`jarvis init` only registers the current repo. It does not create or modify
files in the target repo.

Write the spec as Markdown with GitHub-style task list items:

```md
# <Feature or fix>

- [ ] First task for the agent to complete.
- [ ] Second task for the agent to complete.
```

Then start the loop. The log server must be running before `jarvis run`:

```sh
jarvis log-server
# in a second terminal:
jarvis run spec/<name>/index.md
```

The log server provides a live full-transcript view across sessions; `jarvis
run` refuses to start without it. See
[docs/run-loop.md](docs/run-loop.md#output-destinations) for the difference
between the run terminal, the session log file, and the log server.

For multi-file specs and the recommended `index.md` shape, see
[docs/spec-guidance.md](docs/spec-guidance.md).

## Commands

```txt
jarvis run [--max-iterations <n>] <spec-path>
                           Run the loop against a spec file in a registered project.
jarvis init                Register the current target repo.
jarvis config              View or edit the jarvis config.
jarvis log-server          Run the local log aggregation server.
jarvis cleanup [--dry-run] Remove merged worktrees.
jarvis help                Show usage.
```

Unknown subcommands print usage to stderr and exit non-zero. Every invocation
bootstraps `~/.jarvis/config.json` if it doesn't exist.

## Agents

Jarvis shells out to one underlying agent CLI per iteration. Supported agents
and the binary each one invokes:

| Agent | CLI invoked | Notes |
| --- | --- | --- |
| `claude` | `claude -p --permission-mode acceptEdits` | Prompt is piped on stdin (non-interactive print mode); `--permission-mode acceptEdits` auto-allows file edits and safe filesystem commands without prompting. |
| `codex` | `codex exec --color never --sandbox workspace-write -c approval_policy="on-request"` | Prompt is piped on stdin; `--color never` disables ANSI for log-friendly text; `--sandbox workspace-write` allows writes inside the workspace and blocks network and out-of-workspace writes. |
| `cursor` | `cursor agent -p --output-format text --force --workspace <cwd> "<prompt>"` | Headless print mode; `--force` enables file writes in print mode; `--output-format text` matches transcript shape of other agents; prompt is the trailing positional argument. |
| `opencode` | `opencode run --model <provider/model> --format default <prompt>` | `--model` is required and read from `patchModels.opencode`; permissions are configured via `~/.config/opencode/opencode.json` rather than a CLI flag. See [Opencode setup](#opencode-setup). |
| `airproxy` | `opencode run --model <provider>/<model> --format default <prompt>` | Delegates to opencode with the `AirProxy` provider fixed by jarvis; permissions still use the opencode setup. See [Opencode setup](#opencode-setup). |
| `copilot` | `opencode run --model <provider>/<model> --format default <prompt>` | Delegates to opencode with the `github-copilot` provider fixed by jarvis; permissions still use the opencode setup. See [Opencode setup](#opencode-setup). |

The default fallback order is `claude -> codex -> cursor`. `opencode`,
`airproxy`, and `copilot` are opt-in; add them with
`jarvis config set-order <a,b,c>` or `jarvis config edit`.

### Opencode setup

Opencode-backed agents use opencode's own permission config instead of a
jarvis CLI flag. Before selecting `opencode`, `airproxy`, or `copilot`, run
the one-time permission installer from the jarvis checkout:

```sh
bun run install-opencode-permissions
```

Then edit `~/.jarvis/config.json` to include the opencode-backed agent in
`agentOrder` and set its `patchModels` entry. The generic `opencode` agent
uses exactly the `provider/model` string you configure. For provider-named
agents, see [Provider-named opencode agents](#provider-named-opencode-agents).

### Provider-named opencode agents

The generic `opencode` agent is for users who want to choose the full
`provider/model` string themselves in `patchModels.opencode`. The `airproxy`
and `copilot` agents are separate fallback slots whose providers are fixed by
jarvis; their `patchModels` values still show the full provider/model string
that is passed to opencode.

Example `~/.jarvis/config.json` opt-in:

```json
{
  "version": 1,
  "agentOrder": ["airproxy", "copilot"],
  "patchModels": {
    "claude": "haiku",
    "codex": "gpt-5-codex",
    "cursor": "Composer 2",
    "opencode": "<configure-in-opencode-providers-spec>",
    "airproxy": "AirProxy/claude-haiku-4.5",
    "copilot": "github-copilot/claude-opus-4.7"
  }
}
```

AirProxy assumes the local work-machine sidecar is already available; jarvis
does not perform AirProxy auth. Copilot uses opencode's existing provider auth
flow (`opencode providers` / `opencode auth`). Both agents use the same
permission posture described in [Opencode setup](#opencode-setup).

### `jarvis init`

Run from the root of a target repo under `~/Work`. Registers the repo as a
project in `~/.jarvis/config.json` and writes no files or directories to the
target repo.

Project names are paths relative to `~/Work`:

- `/Users/me/Work/app-a` registers as `app-a`.
- `/Users/me/Work/client/api` registers as `client/api`.

Re-running on an already-registered repo is a no-op (exit 0). If the project
name is already registered to a *different* root, init exits 1 and asks you
to resolve it with `jarvis config`. If the current directory is outside
`~/Work`, init exits 1.

### `jarvis run`

`jarvis run` resolves the spec into a per-spec git worktree under
`.worktree/<spec-name>/`, runs agents from `agentOrder` until the spec has
zero unchecked boxes, and opens a draft PR after the first commit lands. The
PR transitions to ready for review when the spec is complete; jarvis never
merges.

For full details — iteration banner, completion semantics, output
destinations, stop conditions, and exit codes — see
[docs/run-loop.md](docs/run-loop.md). For worktree layout, commit shape, push
cadence, draft PR lifecycle, and blocker handling, see
[docs/worktrees-and-commits.md](docs/worktrees-and-commits.md).

#### Commit shape

Each checked subspec becomes one commit. The subject is the subspec H1, the
first body line is `Spec: <relative subspec path>`, and the body then includes
the subspec's `## Acceptance criteria` section. The index checkbox flip is
staged in that same commit.

Jarvis pushes every subspec commit immediately. The first push sets upstream
tracking with `git push -u origin <branch>`; later pushes use plain
`git push`. After the first subspec commit is pushed, jarvis opens a draft
PR. The PR title comes from the spec `index.md` H1, and the body is generated
once by asking the active agent to summarize the index and linked subspec H1s.
Later commits leave the PR body unchanged. After a pushed commit leaves every
linked subspec checkbox in `index.md` checked, jarvis marks the PR ready for
review with `gh pr ready`.

Normal runs expect the supplied spec path to be an `index.md` file. Passing
a non-index spec file such as `spec/<name>/01-task.md` prompts for one
action: `s` to switch to a sibling `index.md`, `m` to migrate the supplied
spec into index-routed form in one agent iteration, or `e` to exit.

### `jarvis cleanup`

Removes merged worktrees and branches from the local repo after their PRs
have been merged on GitHub. See
[docs/worktrees-and-commits.md](docs/worktrees-and-commits.md#cleanup) for
behavior.

### `jarvis config`

View or edit `~/.jarvis/config.json`. See [docs/config.md](docs/config.md)
for the schema, defaults, and the full list of `jarvis config` subcommands.

Config schema excerpt:

```ts
type AgentName =
  | "claude"
  | "codex"
  | "cursor"
  | "opencode"
  | "airproxy"
  | "copilot";

type Config = {
  version: 1;
  agentOrder: AgentName[];
  patchModels: Record<AgentName, string>;
  maxIterations: number;
  logServerUrl: string;
  logServerBind: string;
  worktreeSymlinks?: string[];
  projects: Record<string, { root: string }>;
};
```

Default contents on first bootstrap:

```json
{
  "version": 1,
  "agentOrder": ["claude", "codex", "cursor"],
  "patchModels": {
    "claude": "haiku",
    "codex": "gpt-5-codex",
    "cursor": "Composer 2",
    "opencode": "<configure-in-opencode-providers-spec>",
    "airproxy": "AirProxy/claude-haiku-4.5",
    "copilot": "github-copilot/claude-opus-4.7"
  },
  "logServerUrl": "http://127.0.0.1:4310/logs",
  "logServerBind": "127.0.0.1:4310",
  "maxIterations": 10,
  "projects": {}
}
```

## Documentation

- [docs/run-loop.md](docs/run-loop.md) — iteration, completion, output
  destinations, stop conditions, exit codes.
- [docs/worktrees-and-commits.md](docs/worktrees-and-commits.md) — worktree
  layout, resume guarantees, commit shape, push cadence, draft PR lifecycle,
  cleanup.
- [docs/agents.md](docs/agents.md) — supported agents (including opencode
  setup), CLI flags jarvis passes, permission posture.
- [docs/config.md](docs/config.md) — `~/.jarvis/config.json` schema,
  defaults, `worktreeSymlinks`, `jarvis config` subcommands.
- [docs/quota-signals.md](docs/quota-signals.md) — per-agent quota detection
  rules.
- [docs/spec-guidance.md](docs/spec-guidance.md) — spec authoring and
  migration guidance for agents and humans.

Agents working *in this repo* should also read
[AGENTS.md](AGENTS.md).

## CI and pull requests

GitHub Actions runs **`bun run typecheck`**, **`bun run test`**, and **`bun
run check`** on pushes to `main` and on pull requests (see
`.github/workflows/ci.yml`).

`CODEOWNERS` lists default reviewers for new PRs. Stricter rules (required
status checks, required reviews, code-owner review) need **branch
protection** on `main`. GitHub only allows that for **public** repositories
or **paid** plans on private repos; until then, use the steps in
`spec/github-ci-and-governance/02-branch-protection-via-gh.md` once the repo
qualifies. That guide configures protection so repository **admins can
bypass** rules when you need to merge without waiting on checks.

## Development

- Biome is the repo's formatter and linter. Run `bun run check` before
  marking specs complete.
- `bun run typecheck` — type-check the project with `tsc --noEmit`.
- `bun run lint` — check Biome lint rules without writing files.
- `bun run format` — write Biome formatting fixes.
- `bun run format:check` — verify Biome formatting without writing files.
- `bun run check` — run the full non-writing Biome code-quality check.
- `bun test` — run the test suite.
- `bun run test:full` — format, check, format-check, lint, typecheck, and
  test in one go.
- `bun run start` — run `src/index.ts`.

Spec authoring and migration guidance for agents lives in
[docs/spec-guidance.md](docs/spec-guidance.md).
