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
  `cursor`, or `opencode`. See [docs/agents.md](docs/agents.md). `opencode`
  is supported but opt-in; see
  [docs/agents.md#opencode-setup](docs/agents.md#opencode-setup) for the
  one-time permission installer.

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
your `PATH`, create the symlink in another directory that is on `PATH`, such
as `~/.local/bin`.

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

Write the spec as Markdown with an optional `repo:` line and GitHub-style task
list items:

```md
# <Feature or fix>

repo: https://github.com/owner/target-repo

- [ ] First task for the agent to complete.
- [ ] Second task for the agent to complete.
```

The `repo:` line is optional. When present, it must be a git URL (HTTPS or
SSH) or an `owner/repo` slug. When omitted, jarvis resolves the target repo
from the spec's location: if the spec lives inside a registered project, that
project wins; if it lives inside any other git checkout, jarvis runs in
ad-hoc mode against that checkout. See
[docs/spec-guidance.md](docs/spec-guidance.md) and
[docs/run-loop.md](docs/run-loop.md) for the full resolution order and the
`--repo` flag.

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
jarvis run [--max-iterations <n>] [--repo <name|path|url>] [--cwd <dir>] <spec-path>
                           Run the loop against a spec file in a registered project.
jarvis plan <intent-file|--inline <text>>
                           Create a draft PR with a placeholder spec tree from a file or inline intent.
                           Real planning content is in flight.
jarvis init                Register the current target repo.
jarvis config              View or edit the jarvis config.
jarvis log-server          Run the local log aggregation server.
jarvis cleanup [--dry-run] Remove merged worktrees.
jarvis triage [worktree-name]
                           Inspect a dirty or orphaned worktree.
jarvis help                Show usage.
```

Unknown subcommands print usage to stderr and exit non-zero. Every invocation
bootstraps `~/.jarvis/config.json` if it doesn't exist.

### `jarvis init`

Run from the root of a target repo under `~/Work`. Registers the repo as a
project in `~/.jarvis/config.json` and writes no files or directories to the
target repo. When the repo has an `origin` remote, init records the URL
under `projects[<name>].origin`; repos without an `origin` remote still
register successfully with a one-line note.

Project names are paths relative to `~/Work`:

- `/Users/me/Work/app-a` registers as `app-a`.
- `/Users/me/Work/client/api` registers as `client/api`.

Re-running on an already-registered repo is a no-op (exit 0). If the project
name is already registered to a *different* root, init exits 1 and asks you
to resolve it with `jarvis config`. If the current directory is outside
`~/Work`, init exits 1.

### `jarvis run`

`jarvis run` resolves the spec into a per-spec git worktree under
`.worktree/<spec-name>/`, runs agents from `modes.patch.agentOrder` until the spec has
zero unchecked boxes, and opens a draft PR after the first commit lands. The
PR transitions to ready for review when the spec is complete; jarvis never
merges. You may start the command from a directory that is not a git checkout
(for example a parent folder that holds multiple repos). Jarvis reads the
supplied spec first, resolves the target repository (see
[docs/run-loop.md](docs/run-loop.md) for the order), and only then prepares
the worktree and runs `gh` / git from that repository.

For full details — iteration banner, completion semantics, output
destinations, stop conditions, and exit codes — see
[docs/run-loop.md](docs/run-loop.md). For worktree layout, commit shape, push
cadence, draft PR lifecycle, and blocker handling, see
[docs/worktrees-and-commits.md](docs/worktrees-and-commits.md).

#### Commit shape

Each checked subspec becomes one commit. The subject is the subspec H1, the
first body line is `Spec: <relative subspec path>`, and the body then includes
the subspec's `## Acceptance criteria` section. The index checkbox flip is
staged in that same commit. Every commit jarvis creates — both subspec
commits and `WIP:` commits — also carries a `Jarvis-Agent: <label>` git
trailer at the end of the message identifying the agent that produced it.
The trailer is omitted when the active agent has no attribution label.

Jarvis pushes every subspec commit immediately. The first push sets upstream
tracking with `git push -u origin <branch>`; later pushes use plain
`git push`. After the first subspec commit is pushed, jarvis opens a draft
PR. The PR title comes from the spec `index.md` H1, and the body has three
parts: a deterministic header (the index H1, a `## Progress` line counting
checked vs total subspecs, and a verbatim mirror of the index subspec
checklist), an agent-authored narrative bracketed by
`<!-- jarvis:narrative:start -->` and `<!-- jarvis:narrative:end -->`
markers, and an attribution footer rendered from the `Jarvis-Agent` git
trailers on the PR-branch subspec commits. The footer lists one bullet per
subspec commit (`- <short sha> <subject> — <agent label>`, with `unknown`
for commits missing the trailer) followed by a deduped summary line of the
form `Written by <Label A>, <Label B> through Jarvis.` (collapsing to
`Written by <Label> through Jarvis.` when only one unique label is
present). Later commits leave the PR body unchanged. After a pushed commit
leaves every linked subspec checkbox in `index.md` checked, jarvis marks
the PR ready for review with `gh pr ready`.

The PR body is rewritten after every successful subspec commit, not only
at draft creation. Each rewrite re-runs the deterministic header and
attribution footer from scratch and preserves whatever lives between the
narrative markers. WIP commits do not trigger a rewrite. If `gh pr edit`
fails, jarvis emits a `harness` warning and continues; the next successful
subspec commit's rewrite heals the body. See
[docs/worktrees-and-commits.md](docs/worktrees-and-commits.md#update-cadence)
for details.

Normal runs expect the supplied spec path to be an `index.md` file. Passing
a non-index spec file such as `spec/<name>/01-task.md` prompts to either
switch to a sibling `index.md` (when one exists) or exit.

### `jarvis cleanup`

Removes merged worktrees and branches from the local repo after their PRs
have been merged on GitHub. See
[docs/worktrees-and-commits.md](docs/worktrees-and-commits.md#cleanup) for
behavior.

### `jarvis config`

View or edit `~/.jarvis/config.json`. See [docs/config.md](docs/config.md)
for the schema, defaults, and the full list of `jarvis config` subcommands.

Recently added subcommands:

- `jarvis config set-git <true|false>` — write the top-level `git` toggle.
- `jarvis config set-project-git <name> <true|false|unset>` — write or clear
  a per-project `git` override.

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
- [docs/spec-guidance.md](docs/spec-guidance.md) — spec authoring guidance
  for agents and humans.

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

Spec authoring guidance for agents lives in
[docs/spec-guidance.md](docs/spec-guidance.md).
