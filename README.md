# jarvis

_If you treat English as code, where combinations of words produce behavior,
then predictable behavior depends on composing those words carefully and
repeatably. Jarvis is that idea applied._

Jarvis is a small TypeScript/Bun harness for running coding-agent CLIs against
Markdown specs. It does not implement an agent itself. Instead, it prepares the
repo, calls one configured CLI at a time, records what happened, and handles the
git and GitHub bookkeeping around each successful step.

The current main workflows are:

1. `jarvis plan` turns an intent (unstructured prompt) into a reviewable spec tree.
2. `jarvis run` implements an existing spec one checked task at a time.

Specs are ordinary Markdown files. Work is complete when the active spec has no
unchecked GitHub-style task-list items left.

## Installation

Prerequisites:

- [Bun](https://bun.sh/)
- [GitHub CLI](https://cli.github.com/) (`gh`) installed and authenticated
- At least one supported agent CLI on `PATH`: `claude`, `codex`, `cursor`,
  `opencode`, or `aider`

Install from a local checkout:

```sh
git clone <this-repo-url> ~/code/jarvis
cd ~/code/jarvis
bun install
ln -s ~/code/jarvis/bin/jarvis /usr/local/bin/jarvis
jarvis help
```

The `bin/jarvis` shim runs `bun src/cli.ts` from this checkout, so keep the
checkout at a stable path. If `/usr/local/bin` is not writable or is not on
your `PATH`, symlink into another directory such as `~/.local/bin`.

## Quickstart

Register the target repo once:

```sh
cd <target-repo>
jarvis init
```

Draft a spec from an intent:

```sh
jarvis plan "Add a settings toggle for dark mode"
```

By default, plan mode creates `spec/YYYY-MM-DDTHH-mm-ssZ-<name>/` on a
`plan/<name>` branch, opens a draft PR, runs refinement and self-review passes,
then marks the plan PR ready when all phases succeed. Review and merge that PR
before implementation.

Run the implementation loop after the spec is available on the target branch:

```sh
jarvis log-server
# in another terminal
jarvis run spec/YYYY-MM-DDTHH-mm-ssZ-<name>/index.md
```

`jarvis run` creates or resumes `.worktree/<spec-name>/`, invokes agents from
`modes.patch.agentOrder`, commits each completed subspec, pushes after every
commit, opens or updates a draft PR, and marks the PR ready when the checklist
is complete. Jarvis never merges PRs.

For specs that should live outside the target repo, set
`modes.plan.commit: false` in `~/.jarvis/config.json`. Plan output then goes to
`~/.jarvis/specs/...`, no branch or PR is created, and the generated `repo:`
line lets `jarvis run` resolve the target repo later.

## Spec Shape

The recommended spec layout is an index file plus atomic subspec files:

```text
spec/YYYY-MM-DDTHH-mm-ssZ-my-feature/
  index.md
  intent.md
  00-first-task.md
  01-second-task.md
```

`index.md` routes work:

```md
# My Feature

repo: https://github.com/owner/repo

- [ ] [00 - First task](./00-first-task.md)
- [ ] [01 - Second task](./01-second-task.md)
```

Each subspec should include a `## Acceptance criteria` checklist. During
`jarvis run`, the active agent is expected to complete one focused piece of
work and tick the criteria it actually satisfied. Jarvis uses those checkbox
transitions to decide whether to commit a completed subspec, make a `WIP:`
progress commit, stop for no progress, or stop on a blocker.

See [docs/spec-guidance.md](docs/spec-guidance.md) for the full authoring
contract.

## Commands

```text
jarvis run [--max-iterations <n>] [--repo <name|path|url>] [--cwd <dir>] <spec-path>
    Implement an existing spec. `--cwd` is only valid when effective git is false.

jarvis plan [--refine-turns <n>] [--review-passes <n>] [--repo <name|path|url>] [--cwd <dir>] [<intent-file|"inline text">]
    Draft a spec through intent refinement, initial drafting, and self-review.

jarvis plan --resume <spec-dir-or-index-path>
    Resume an existing plan branch/worktree for more refinement or review passes.

jarvis init
    Register the current repo in ~/.jarvis/config.json.

jarvis config
    Show or edit config. Use `jarvis config show`, `path`, `projects`,
    `set-patch-order`, `set-plan-order`, `set-git`, `set-project-git`,
    `remove-project`, and `edit`.

jarvis prices
    Show or edit model pricing data used for cost summaries.

jarvis log-server
    Start the local full-transcript log server required by `jarvis run`.

jarvis cleanup [--dry-run]
    Remove merged local worktrees and matching branches, then try to archive
    matching spec directories under `spec/completed/`, commit that archive
    move, and push the cleanup commit.

jarvis triage [worktree-name]
    Inspect dirty or orphaned worktrees and print suggested next moves.

jarvis review-feedback <worktree-name>
    Address PR review feedback on an existing patch worktree.

jarvis help
    Show CLI usage.
```

Unknown subcommands print usage and exit non-zero. Every invocation bootstraps
`~/.jarvis/config.json` if needed.

### `jarvis review-feedback` workflow

`jarvis review-feedback <worktree-name>` runs inside an existing patch worktree at
`.worktree/<worktree-name>/` and performs one harness-controlled pass:

1. Require a clean starting worktree and an open PR for the current branch.
2. Collect actionable open feedback (unresolved inline threads + eligible
   top-level PR comments for the current review round).
3. Build a review prompt and run agents in `modes.patch.agentOrder` fallback
   order.
4. If an agent succeeds and files changed, create one harness commit with the
   fixed message `address PR review comments` and push it.

Current non-goals in v1: auto-resolving review threads, posting GitHub replies,
or editing PR metadata.

## Configuration

Jarvis state lives under `~/.jarvis/`:

```text
~/.jarvis/
  config.json
  runs.jsonl
  sessions/
  specs/
```

Config version 2 is mode-specific. Patch mode (`jarvis run`) and plan mode
(`jarvis plan`) each have their own ordered list of agent/model entries:

```json
{
  "version": 2,
  "modes": {
    "patch": {
      "agentOrder": [
        {
          "agent": "claude",
          "model": "haiku"
        },
        {
          "agent": "codex",
          "model": "gpt-5.3-codex"
        },
        {
          "agent": "cursor",
          "model": "Composer 2.5"
        },
        {
          "agent": "aider",
          "model": "ollama_chat/qwen3.6:35b"
        }
      ]
    },
    "plan": {
      "agentOrder": [
        {
          "agent": "claude",
          "model": "sonnet"
        },
        {
          "agent": "codex",
          "model": "gpt-5.4"
        },
        {
          "agent": "cursor",
          "model": "Composer 2.5"
        },
        {
          "agent": "aider",
          "model": "ollama_chat/qwen3.6:35b"
        }
      ],
      "specTimestamp": false,
      "commit": false
    }
  },
  "quotaFallback": "lenient",
  "weakQuotaExitCodes": [],
  "maxIterations": 10,
  "iterationTimeoutMs": 1800000,

  "logServerUrl": "http://127.0.0.1:4310/logs",
  "logServerBind": "127.0.0.1:4310",
  "telemetryPath": "/path/to/.jarvis/runs.jsonl",
  "git": true,
  "projects": {
    "jarvis": {
      "root": "/path/to/jarvis",
      "origin": "git@github.com:cbrenner04/jarvis.git",
      "plan": {
        "specTimestamp": true,
        "commit": true
      }
    },
    "groceries-client": {
      "root": "path/to/groceries-client",
      "origin": "git@github.com:cbrenner04/groceries-client.git",
      "siblings": [
        "path/to/groceries_features",
        "path/to/groceries_features_results",
        "path/to/groceries-service"
      ]
    },
    "groceries-service": {
      "root": "path/to/groceries-service",
      "siblings": [
        "path/to/groceries_features",
        "path/to/groceries_features_results",
        "path/to/groceries-client"
      ]
    },
    "groceries_features": {
      "root": "path/to/groceries_features",
      "origin": "git@github.com:cbrenner04/groceries_features.git",
      "siblings": [
        "path/to/groceries-service",
        "path/to/groceries_features_results",
        "path/to/groceries-client"
      ]
    },
    "groceries_features_results": {
      "root": "path/to/groceries_features_results",
      "siblings": [
        "path/to/groceries_features",
        "path/to/groceries_features-service",
        "path/to/groceries-client"
      ]
    }
  }
}
```

Default agent order is `claude`, `codex`, then `cursor`. `opencode` and
`aider` are supported but opt in; add them to `modes.patch.agentOrder` or
`modes.plan.agentOrder` with an explicit model string. `jarvis config
set-patch-order` and `jarvis config set-plan-order` replace a whole order with
comma-separated `agent:model` pairs.

Important switches:

- `git: false` disables worktrees, commits, pushes, and PRs for `jarvis run`.
  The agent runs in the project root, or in `--cwd <dir>` when supplied.
- `modes.plan.commit: false` stores plan-generated specs under
  `~/.jarvis/specs/...` instead of committing them to the target repo.
- `worktreeSymlinks` can symlink paths such as `node_modules` into run
  worktrees.
- `projects[<name>].siblings` exposes sibling repos to agents for multi-repo
  work.
- `telemetryPath: null` disables JSONL telemetry.

See [docs/config.md](docs/config.md) for the full schema and validation rules.

## Agents and Output

Jarvis invokes exactly one agent CLI per phase or iteration. If an agent
reports quota exhaustion, Jarvis rotates to the next configured agent. Model
configuration errors do not fall back.

Supported agents:

- `claude`: JSON print mode, token and cost extraction from Claude output.
- `codex`: `codex exec` with workspace-write sandboxing, token usage
  correlated from Codex session JSONL when unambiguous.
- `cursor`: headless `cursor agent`; token usage is estimated when possible
  and otherwise recorded as unavailable.
- `opencode`: opt-in `opencode run`; permissions are configured in opencode's
  config file.
- `aider`: opt-in `aider --message`; useful for local model workflows.

Run output is split by purpose:

- The run terminal shows concise harness progress and stop reasons.
- `~/.jarvis/sessions/*.log` stores the complete transcript.
- `jarvis log-server` provides a live full-transcript viewer.
- `~/.jarvis/runs.jsonl` stores per-invocation telemetry and cost data.

See [docs/agents.md](docs/agents.md), [docs/run-loop.md](docs/run-loop.md),
and [docs/quota-signals.md](docs/quota-signals.md).

## Git and PR Behavior

With `git: true`, `jarvis run` creates a branch-backed worktree under
`.worktree/<spec-name>/`. Each completed subspec becomes one commit whose body
starts with `Spec: <relative subspec path>` and includes that subspec's
acceptance criteria. Jarvis adds a `Jarvis-Agent: <label>` trailer to commits
it creates.

After the first subspec commit is pushed, Jarvis opens a draft PR. The PR body
is regenerated after successful subspec commits from the spec index and commit
trailers while preserving the narrative section between Jarvis markers. When
the spec is complete, Jarvis runs `gh pr ready`.

Plan mode uses `plan/<name>` branches and `.worktree/plan-<name>/` worktrees
when `modes.plan.commit` is true. Its commits are `plan: refine`,
`plan: draft`, `plan: review N`, and `plan: blocker`.

See [docs/worktrees-and-commits.md](docs/worktrees-and-commits.md) for the
details, including cleanup and triage behavior.

## Documentation

- [docs/run-loop.md](docs/run-loop.md): `jarvis run` resolution, iteration,
  completion, output destinations, telemetry, stop conditions, and exit codes.
- [docs/plan-mode.md](docs/plan-mode.md): `jarvis plan` phases, flags, commit
  and no-commit modes, resume, PR lifecycle, and blockers.
- [docs/workflows.md](docs/workflows.md): visual control-flow diagrams for
  plan and patch mode.
- [docs/worktrees-and-commits.md](docs/worktrees-and-commits.md): worktree
  layout, commits, PR bodies, cleanup, and triage.
- [docs/agents.md](docs/agents.md): supported CLIs, exact flags, usage
  extraction, permission posture, and opt-in setup.
- [docs/config.md](docs/config.md): config schema, defaults, project
  registration, siblings, and config subcommands.
- [docs/quota-signals.md](docs/quota-signals.md): quota/model/error
  classification and fallback behavior.
- [docs/spec-guidance.md](docs/spec-guidance.md): current spec authoring
  conventions.
- [docs/agent-cli-failure-pipeline.md](docs/agent-cli-failure-pipeline.md):
  classification pipeline for agent CLI failures.

Agents working in this repository should also read [AGENTS.md](AGENTS.md).

## Development

This repo is TypeScript on Bun with strict compiler settings and Biome for
formatting and linting.

Read-only checks:

- `bun run typecheck`
- `bun test`
- `bun run lint`
- `bun run format:check`
- `bun run check`

Write-enabled fixes:

- `bun run format`
- `bun run lint:fix`
- `bun run check:fix`

Unsafe fix variants are also available as `format:unsafe`,
`lint:fix:unsafe`, and `check:fix:unsafe`; inspect their diffs carefully.

### Per-test timeout

The test suite enforces a 30-second per-test timeout via the `bun test` script
(`--timeout=30000`). If a test genuinely needs more time, pass
`{ timeout: <ms> }` to `test(name, opts, fn)`:

```typescript
test("slow operation", { timeout: 60000 }, async () => {
  // Test body
});
```

The timeout is a backstop against hung tests hanging the entire suite. Do not
increase the default or add per-test timeouts speculatively; only when a test
legitimately requires more time.

Before moving a PR out of draft, run:

```sh
bun run ready
```

That script runs `bun install --frozen-lockfile` first so Biome is available,
then `bun run check:fix` (Biome's safe format and lint-rule fixer), `bun run
typecheck`, `bun run test`, and `bun run check` with a 10-minute wall-clock
deadline. If any step hangs or the total time exceeds 10 minutes, the script
kills the process tree and exits with code 124.

Override the default 10-minute timeout via the `JARVIS_READY_TIMEOUT_MS`
environment variable (in milliseconds):

```sh
JARVIS_READY_TIMEOUT_MS=600000 bun run ready   # 10 minutes (default)
JARVIS_READY_TIMEOUT_MS=1800000 bun run ready  # 30 minutes
```

Invalid or unset values fall back to the 10-minute default with a warning.
