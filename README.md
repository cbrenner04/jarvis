# jarvis

_When an LLM is the interpreter, English is code. Combinations of words produce
behavior, and like any code, predictable behavior depends on composing those
words carefully and repeatably. Jarvis is that idea applied._

Jarvis is a TypeScript/Bun harness for running coding-agent CLIs against
Markdown specs. It does not implement an agent itself. Instead, it prepares the
repo, calls one configured CLI at a time, records what happened, and handles the
git and GitHub bookkeeping around each successful step.

The current main workflows are:

1. `jarvis1 plan` turns an intent (unstructured prompt) into a reviewable spec tree.
2. `jarvis1 run` implements an existing spec one checked task at a time.
3. `jarvis1 prompt` invokes an agent with a one-shot prompt, optionally committing and opening a PR.

Specs are ordinary Markdown files. Work is complete when the active spec has no
unchecked GitHub-style task-list items left.

## Installation

Prerequisites:

- [Bun](https://bun.sh/)
- [GitHub CLI](https://cli.github.com/) (`gh`) installed and authenticated
- At least one supported agent CLI on `PATH`: `claude`, `codex`, `cursor`,
  or `opencode`

Install from a local checkout:

```sh
git clone <this-repo-url> ~/code/jarvis
cd ~/code/jarvis
bun install
ln -s ~/code/jarvis/bin/jarvis1 /usr/local/bin/jarvis1
jarvis1 help
```

The `bin/jarvis1` shim runs `bun v1/src/cli.ts` from this checkout, so keep the
checkout at a stable path. If `/usr/local/bin` is not writable or is not on
your `PATH`, symlink into another directory such as `~/.local/bin`.
`jarvis1` remains the daily-driver v1 command. The bare `jarvis` command now
resolves to an intentionally minimal v2 scaffold (`v2 not ready` or
`--version`).

## Quickstart

Register the target repo once:

```sh
cd <target-repo>
jarvis1 init
```

Draft a spec from an intent:

```sh
jarvis1 plan "Add a settings toggle for dark mode"
```

By default, plan mode creates `spec/YYYY-MM-DDTHH-mm-ssZ-<name>/` on a
`plan/<name>` branch, opens a draft PR, runs refinement and self-review passes,
then marks the plan PR ready when all phases succeed. Review and merge that PR
before implementation.

Run the implementation loop after the spec is available on the target branch:

```sh
jarvis1 log-server
# in another terminal
jarvis1 run spec/YYYY-MM-DDTHH-mm-ssZ-<name>/index.md
```

`jarvis1 run` creates or resumes `.worktree/<spec-name>/`, invokes agents from
`modes.patch.agentOrder`, commits each completed subspec, pushes after every
commit, opens or updates a draft PR. After the checklist is complete, the review
phase runs one or more agent passes (configured by `modes.review.passes`,
default 2) to critique and refactor the implementation, then marks the PR ready
when all phases succeed. Jarvis never merges PRs.

For specs that should live outside the target repo, set
`modes.plan.commit: false` in `~/.jarvis/config.json`. Plan output then goes to
`~/.jarvis/specs/...`, no branch or PR is created, and the generated `repo:`
line lets `jarvis1 run` resolve the target repo later.

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
`jarvis1 run`, the active agent is expected to complete one focused piece of
work and tick the criteria it actually satisfied. Jarvis uses those checkbox
transitions to decide whether to commit a completed subspec, make a `WIP:`
progress commit, stop for no progress, or stop on a blocker.

See [v1/docs/spec-guidance.md](v1/docs/spec-guidance.md) for the full authoring
contract.

## Repository Layout

After the v1/v2 split, the repository has three distinct areas:

- **Root** (`/`): Shared glue and repo-wide guidance. Contains `bin/jarvis1` (shim that runs the v1 engine), the single `package.json`, version-agnostic `scripts/` (`ready`, opencode permissions) and `data/` (global `prices.json`), and documentation files (`README.md`, `AGENTS.md`).
- **v1** (`v1/`): The shipping harness implementation. Contains `src/`, `test/`, `docs/`, and `spec/`. All current jarvis functionality lives here. The root `bin/jarvis1` shim dispatches to `v1/src/cli.ts`.
- **v2** (`v2/`): Phase-0 scaffold for the future v2 engine. Contains a minimal CLI entry at `v2/src/cli.ts` plus planning docs/specs.

From a user's perspective, `jarvis1` dispatches to the v1 engine and remains
the production path. Bare `jarvis` dispatches to the intentionally minimal v2
scaffold.

## Commands

```text
jarvis1 run [--max-iterations <n>] [--repo <name|path|url>] [--cwd <dir>] [--resume-review] <spec-path>
    Implement an existing spec. `--cwd` is only valid when effective git is false.
    `--resume-review` re-enters post-completion review on an already-complete spec;
    requires review enabled, git mode on, implementation PR/remote branch to exist,
    and zero unchecked tasks.

jarvis1 plan [--refine-turns <n>] [--review-passes <n>] [--repo <name|path|url>] [--cwd <dir>] [<intent-file|"inline text">]
    Draft a spec through intent refinement, initial drafting, and self-review.

jarvis1 plan --resume <spec-path>
    Resume an existing plan branch/worktree for more refinement or review passes.

jarvis1 prompt [--repo <name|path|url>] <text>
    Run an agent against a prompt in a registered project.

jarvis1 init
    Register the current repo in ~/.jarvis/config.json.

jarvis1 config
    Show or edit config. Use `jarvis1 config show`, `path`, `projects`,
    `set-patch-order`, `set-plan-order`, `set-git`, `set-project-git`,
    `remove-project`, and `edit`.

jarvis1 prices
    Show or edit model pricing data used for cost summaries.

jarvis1 log-server
    Start the local full-transcript log server required by `jarvis1 run`.

jarvis1 cleanup [--dry-run]
    Remove merged local worktrees and matching branches, then try to archive
    matching spec directories under `spec/completed/`, commit that archive
    move, and push the cleanup commit.

jarvis1 triage [worktree-name]
    Inspect dirty or orphaned worktrees and print suggested next moves.

jarvis1 review-feedback <worktree-name>
    Address PR review feedback on an existing patch worktree.

jarvis1 help
    Show CLI usage.
```

Unknown subcommands print usage and exit non-zero. Every invocation bootstraps
`~/.jarvis/config.json` if needed.

### `jarvis1 review-feedback` workflow

`jarvis1 review-feedback <worktree-name>` auto-materializes `.worktree/<worktree-name>/` from `origin/<worktree-name>` (or a local branch if no remote exists) when the worktree is missing and `git: true` in config. It errors with `no local or remote branch named <name>` if neither exists. The worktree must start clean and performs one harness-controlled pass:

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

Config version 2 is mode-specific. Patch mode (`jarvis1 run`) and plan mode
(`jarvis1 plan`) each have their own ordered list of agent/model entries:

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
        }
      ],
      "specTimestamp": false,
      "commit": false
    }
  },
  "quotaFallback": "lenient",
  "weakQuotaExitCodes": [],
  "maxIterations": 10,
  "iterationTimeoutMs": 600000,

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

Default agent order is `claude`, `codex`, then `cursor`. `opencode` is
supported but opt in; add it to `modes.patch.agentOrder` or
`modes.plan.agentOrder` with an explicit model string. `jarvis1 config
set-patch-order` and `jarvis1 config set-plan-order` replace a whole order with
comma-separated `agent:model` pairs.

Important switches:

- `git: false` disables worktrees, commits, pushes, and PRs for `jarvis1 run`.
  The agent runs in the project root, or in `--cwd <dir>` when supplied.
- `modes.plan.commit: false` stores plan-generated specs under
  `~/.jarvis/specs/...` instead of committing them to the target repo.
- `worktreeSymlinks` can symlink paths such as `node_modules` into run
  worktrees.
- `projects[<name>].siblings` exposes sibling repos to agents for multi-repo
  work.
- `telemetryPath: null` disables JSONL telemetry.

See [v1/docs/config.md](v1/docs/config.md) for the full schema and validation rules.

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

Run output is split by purpose:

- The run terminal shows concise harness progress and stop reasons.
- `~/.jarvis/sessions/*.log` stores the complete transcript.
- `jarvis1 log-server` provides a live full-transcript viewer.
- `~/.jarvis/runs.jsonl` stores per-invocation telemetry and cost data.

See [v1/docs/agents.md](v1/docs/agents.md), [v1/docs/run-loop.md](v1/docs/run-loop.md),
and [v1/docs/quota-signals.md](v1/docs/quota-signals.md).

## Git and PR Behavior

With `git: true`, `jarvis1 run` creates a branch-backed worktree under
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

See [v1/docs/worktrees-and-commits.md](v1/docs/worktrees-and-commits.md) for the
details, including cleanup and triage behavior.

## Documentation

- [v1/docs/run-loop.md](v1/docs/run-loop.md): `jarvis1 run` resolution, iteration,
  completion, output destinations, telemetry, stop conditions, and exit codes.
- [v1/docs/plan-mode.md](v1/docs/plan-mode.md): `jarvis1 plan` phases, flags, commit
  and no-commit modes, resume, PR lifecycle, and blockers.
- [v1/docs/workflows.md](v1/docs/workflows.md): visual control-flow diagrams for
  plan and patch mode.
- [v1/docs/worktrees-and-commits.md](v1/docs/worktrees-and-commits.md): worktree
  layout, commits, PR bodies, cleanup, and triage.
- [v1/docs/agents.md](v1/docs/agents.md): supported CLIs, exact flags, usage
  extraction, permission posture, and opt-in setup.
- [v1/docs/config.md](v1/docs/config.md): config schema, defaults, project
  registration, siblings, and config subcommands.
- [v1/docs/quota-signals.md](v1/docs/quota-signals.md): quota/model/error
  classification and fallback behavior.
- [v1/docs/spec-guidance.md](v1/docs/spec-guidance.md): current spec authoring
  conventions.
- [v1/docs/agent-cli-failure-pipeline.md](v1/docs/agent-cli-failure-pipeline.md):
  classification pipeline for agent CLI failures.
- [v1/docs/test-coverage.md](v1/docs/test-coverage.md): coverage measurement
  scripts and how to read Bun's output.

Agents working in this repository should also read [AGENTS.md](AGENTS.md).

## Hit a harness gap?

Found friction using Jarvis on another repo? [Submit a harness suggestion](https://github.com/cbrenner04/jarvis/issues/new/choose).

## Development

This repo is TypeScript on Bun with strict compiler settings and Biome for
formatting and linting.

Read-only checks:

- `bun run typecheck`
- `bun run test`
- `bun run lint`
- `bun run format:check`
- `bun run check`
- `bun run lint:md` — Markdown linter for specs, docs, and reports; invokes `markdownlint-cli2` with config at `.markdownlint-cli2.jsonc`

Write-enabled fixes:

- `bun run format`
- `bun run lint:fix`
- `bun run check:fix`

Unsafe fix variants are also available as `format:unsafe`,
`lint:fix:unsafe`, and `check:fix:unsafe`; inspect their diffs carefully.

### Markdown linting

`bun run lint:md` lints Markdown files across `v1/spec/`, `v1/docs/`, `reports/`,
and root docs (`README.md`, `AGENTS.md`). Completed specs under `**/completed/**`
are exempted. The linter is rules-based and non-mutating; violations report
genuine deviations from conventions (spacing, headings, and list markers)
rather than style noise. See `.markdownlint-cli2.jsonc` for the active rule set.

### Per-test timeout

The test suite enforces a 30-second per-test timeout via `bunfig.toml`
(`[test] timeout = 30000`). If a test genuinely needs more time, pass
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
typecheck`, `bun run test`, `bun run check`, and `bun run lint:md` with a 10-minute wall-clock
deadline. If any step hangs or the total time exceeds 10 minutes, the script
kills the process tree and exits with code 124.

Override the default 10-minute timeout via the `JARVIS_READY_TIMEOUT_MS`
environment variable (in milliseconds):

```sh
JARVIS_READY_TIMEOUT_MS=600000 bun run ready   # 10 minutes (default)
JARVIS_READY_TIMEOUT_MS=1800000 bun run ready  # 30 minutes
```

Invalid or unset values fall back to the 10-minute default with a warning.
