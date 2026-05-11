# jarvis
Coding agent harness

## Installation

Prerequisites:

- [Bun](https://bun.sh/) installed.
- [GitHub CLI](https://cli.github.com/) (`gh`) installed and authenticated
  (run `gh auth login` if needed).
- At least one supported agent CLI available on `PATH`: `claude`, `codex`, or
  `cursor`.

Install jarvis from a local clone:

```sh
git clone <this-repo-url> ~/code/jarvis
cd ~/code/jarvis
bun install
ln -s ~/code/jarvis/bin/jarvis /usr/local/bin/jarvis
jarvis help
```

Clone the repo to a stable path because the `jarvis` executable is a symlink
back into that checkout. If `/usr/local/bin` is not writable or is not on your
`PATH`, create the symlink in another directory that is on `PATH`.

## Quickstart

From the repository you want jarvis to work on:

```sh
cd <target-repo>
jarvis init
mkdir -p spec
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

Then start the loop:

```sh
jarvis log-server
# in a second terminal:
jarvis run spec/<name>/index.md
```

Normal runs expect the supplied spec path to be an `index.md` file. Passing a
direct spec file such as `spec/<name>/01-task.md` asks for confirmation first;
when confirmed, jarvis runs that direct spec for one successful agent iteration
instead of entering the normal loop.

### Worktree directory

Spec runs create dedicated git worktrees under `.worktree/<spec-name>/`. The
`.worktree/` directory is tracked (via `.worktree/.keep`) so clones receive it,
but its contents are ignored in git — only `.keep` is committed.

#### Resume guarantees

When re-running a spec:

- **Worktree and branch both exist**: reuse both
- **Worktree missing, branch exists locally or remotely**: recreate worktree on
  the existing branch
- **Neither exist**: create new branch off the detected base branch and new
  worktree

The agent runs in the worktree, not the main checkout, so concurrent spec runs
(with different specs) do not interfere with each other.

#### Commit shape

Each completed subspec produces exactly one commit. The commit subject is the
subspec's H1 heading (the first `# ` line), verbatim. The commit body includes:

1. First line: `Spec: <relative path to subspec from repo root>`
2. A blank line
3. The verbatim `## Acceptance criteria` section from the subspec

The same commit also flips the index.md checkbox for the subspec from `[ ]` to
`[x]`, staging both the work and the index update together.

#### Draft PR creation

After the first successful subspec commit lands, `jarvis run` opens a draft PR:

- **Title**: the H1 from the spec's `index.md` (e.g., "Git Workflow")
- **Body**: a summary of the spec index and subspec H1 headings
- **Base branch**: the branch detected by subspec 01

The PR remains in draft until the spec is complete. If a PR already exists (on
resume), it is reused without modification to the body.

#### Push cadence

Each subspec commit is pushed immediately:

- **First commit**: `git push -u origin <branch>` (sets up tracking)
- **Subsequent commits**: `git push` (uses tracking from first push)

Push failures are errors that halt work; there is no automatic retry. This keeps
the draft PR synchronized with the latest commit, allowing reviewers and CI to
see incremental progress.

#### Blocker handling

When a subspec cannot be completed (due to hook failure, ambiguity, or other
issues), the active agent appends a `## Blocker` section to the subspec
describing the problem, then commits and pushes as WIP. See
[AGENTS.md](./AGENTS.md#working-rules-for-agents-in-this-repo) for the blocker
convention and resolution process.

#### Ready for review

When the final subspec is completed and pushed, the draft PR automatically
transitions to ready for review (via `gh pr ready`). Jarvis never merges; human
reviewers are responsible for approval and merge decisions.

Agents that need to create or migrate specs should follow
[docs/spec-guidance.md](docs/spec-guidance.md).

## Usage

```
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

### `jarvis init`

Run from the root of a target repo under `~/Work`. Registers the repo as a
project in `~/.jarvis/config.json` and writes no files or directories to the
target repo.

Project names are paths relative to `~/Work`:

- `/Users/me/Work/app-a` registers as `app-a`.
- `/Users/me/Work/client/api` registers as `client/api`.

Re-running on an already-registered repo is a no-op (exit 0). If the project
name is already registered to a *different* root, init exits 1 and asks you to
resolve it with `jarvis config`. If the current directory is outside `~/Work`,
init exits 1.

### `jarvis cleanup [--dry-run]`

Removes merged worktrees and branches from the local repo. Useful after PRs have
been merged on GitHub to keep `.worktree/` tidy.

Behavior:

- Lists all worktrees whose corresponding PR has `state: MERGED`.
- Skips worktrees with uncommitted changes or unpushed commits.
- Prompts for confirmation before removal (use `--dry-run` to preview).
- Removes the worktree directory and deletes the local branch.

The `.worktree/.keep` directory is never removed.

## Agents

Jarvis shells out to one underlying agent CLI per iteration. Supported agents
and the binary each one invokes:

| Agent    | CLI invoked | Notes                                                |
| -------- | ----------- | ---------------------------------------------------- |
| `claude` | `claude -p --permission-mode acceptEdits` | Prompt is piped on stdin (non-interactive print mode); `--permission-mode acceptEdits` auto-allows file edits and safe filesystem commands without prompting (`claude --help`). |
| `codex`  | `codex exec --color never --sandbox workspace-write -c approval_policy="on-request"` | Prompt is piped on stdin; `--color never` disables ANSI for log-friendly text; `--sandbox workspace-write` allows writes inside the workspace and blocks network and out-of-workspace writes; `-c approval_policy="on-request"` pins approval behavior through Codex's config override channel (`codex exec --help`). |
| `cursor` | `cursor agent -p --output-format text --force --workspace <cwd> "<prompt>"` | Headless print mode; `--force` enables file writes in print mode; `--output-format text` matches transcript shape of other agents; prompt is the trailing positional argument (`cursor agent --help`). |

Quota detection is per-agent and based on documented or observed stderr
signals; see [docs/quota-signals.md](docs/quota-signals.md).

### Agent CLI verbosity

Jarvis does not strip or rewrite agent transcripts; it delegates presentation to
each upstream CLI. Current defaults:

- **Claude**: `-p` only — readable enough for the harness; avoids `--verbose` /
  `--debug` noise.
- **Codex**: `--color never` — removes escape codes so logs resemble the other
  agents’ plain stdout.
- **Cursor**: `--output-format text` with `-p` — same intent as Claude’s default
  print transcript (JSON/stream modes would flood logs).

### Permission posture

Jarvis invokes agents with a `safe-edits` permission posture that allows:

- File reads and edits under the agent’s working directory (the target repo
  root).
- Common read-only and safe filesystem operations: `mkdir`, `mv`, `cp`, read-only
  `git` (`status`, `log`, `diff`, `show`), etc.
- Prompt submission to the model within the agent’s normal permission rules.

The posture **does not** allow without user confirmation:

- Network egress (`curl`, `wget`, package installs).
- Destructive commands targeting the filesystem root or home directory.
- Writes outside the target repository.

Jarvis **never** passes a provider’s "bypass everything" or "dangerously skip
permissions" flags (e.g., `--dangerously-skip-permissions`, `--force-allow-all`).
Users who need to run an agent with fewer restrictions should invoke the CLI
directly. The rationale and per-provider implementation are documented in
[spec/permissions/](spec/permissions/).

### How jarvis decides the spec is done

Jarvis treats a spec as complete when the spec file has zero unchecked
GitHub-style task list items. An unchecked item is a line matching
`^\s*- \[ \]\s`; checked items use `- [x]` or `- [X]`.

A spec with no task list checkboxes is malformed. Jarvis fails fast instead of
treating it as complete.

### How the loop works

`jarvis run <spec-path>` resolves the spec to an absolute path, finds the
registered project root that contains it, and runs agents from `agentOrder`
until the spec has no unchecked boxes. Normal runs use an `index.md` spec so
agents select one indexed task per invocation.

When `<spec-path>` is not named `index.md`, jarvis prompts before invoking any
agent. Confirming the prompt runs the supplied spec for one successful work
iteration, with quota fallback still allowed before that work iteration. If
unchecked tasks remain afterward, jarvis exits 0 and reports that the
one-iteration run finished with unchecked tasks remaining.

Each iteration prints a banner before agent invocation with:
project key, spec display name (`basename(specPath)`), iteration number, current
task excerpt (`first unchecked checkbox` in document order), and selected agent.
The `current-task` field also includes unchecked ordinal/total (`1/N`) so it is
distinct from loop iteration count. Task excerpts are truncated to 140 chars.

Jarvis then builds the standard prompt and invokes the agent with `cwd` set to
the target repo root. The prompt asks the agent to discover target-repo guidance
and injects jarvis-owned rules from `rules/patch-mode.md` inline.

`jarvis run` requires the local log server to be reachable before the loop starts.
If the server is down or misconfigured, run exits non-zero and prints a
connectivity error.

Patch mode selects the model configured for the chosen agent in `patchModels`.
Patch mode is intended for scoped implementation work from an active spec, so
the defaults prefer lower-cost coding-capable models over deep-thinking models.
Future jarvis modes may use separate model settings.

Jarvis validates the local config shape before invoking an agent, so malformed
`patchModels` config fails before any CLI runs. Jarvis does not query providers
or CLIs before running to validate model availability. If the selected agent CLI
reports that the configured model is unsupported, jarvis exits with a
model-configuration message and does not fall back to another agent. Fallback is
reserved for quota exhaustion: if an agent reports quota exhaustion, jarvis
removes it from the active list for that run and falls back to the next
configured agent.

### Terminal output, session logs, and log-server

The `jarvis run` terminal, session files, and log server serve different purposes:

- **Run terminal**: Operator-focused output showing harness status and progress.
  Prints the iteration banner, agent fallback messages, completion status, and
  stop reasons. Does not print successful agent stdout/stderr to keep the
  terminal concise. On no-progress or max-iteration stops, prints a bounded tail
  (last 40 lines) of the latest iteration's inbound output before the stop line
  to help diagnose the failure.
- **Session log file**: The canonical complete transcript. Located at
  `~/.jarvis/sessions/<project-key>-<timestamp>.log`, it contains every log
  record including harness status, iteration banners, outbound prompts, full
  inbound stdout/stderr, quota messages, and model-configuration failures. Use
  this file to reconstruct the complete run if you need details not shown in
  the terminal.
- **Log server**: Live full-transcript viewer for monitoring across sessions.
  Receives the same complete tagged stream as the session log. Accessible via
  `jarvis log-server`.

If a successful iteration leaves the unchecked-task count unchanged and the spec
is still incomplete, jarvis stops with exit 4. Runs also stop at
`maxIterations`, which defaults to 10 and can be overridden with
`--max-iterations <n>`. On these stops, the bounded tail of recent agent output
is printed to the terminal to help diagnose why progress stalled.

Exit codes:

- `0` — spec complete.
- `1` — bad input.
- `2` — every configured agent was quota-exhausted.
- `3` — the active agent failed for a non-quota reason.
- `4` — a successful agent iteration made no progress.
- `5` — the configured maximum iteration count was reached.
- `130` — interrupted with Ctrl-C.

## Development

- Biome is the repo's formatter and linter. Run `bun run check` before marking
  specs complete.
- Spec authoring and migration guidance for agents lives in
  [docs/spec-guidance.md](docs/spec-guidance.md).
- `bun run typecheck` — type-check the project with `tsc --noEmit`.
- `bun run lint` — check Biome lint rules without writing files.
- `bun run format` — write Biome formatting fixes.
- `bun run format:check` — verify Biome formatting without writing files.
- `bun run check` — run the full non-writing Biome code-quality check.
- `bun test` — run the test suite.
- `bun run start` — run `src/index.ts`.

### Configuration

`jarvis config` subcommands view and edit `~/.jarvis/config.json`:

- `jarvis config show` — print the current config as JSON.
- `jarvis config path` — print the absolute path of `config.json`.
- `jarvis config set-order <a,b,c>` — replace `agentOrder` with a comma-separated
  list of agents. Rejects unknown agents and duplicates.
- Patch-mode model settings in `patchModels` are edited manually in
  `~/.jarvis/config.json` for now.
- `jarvis config projects` — list registered projects.
- `jarvis config remove-project <name>` — remove a registered project.
- `jarvis config edit` — open `config.json` in `$EDITOR` (fallback `vi`); the
  edited file is re-validated on save and a non-zero exit is returned if it is
  invalid.

## Configuration file

Jarvis keeps its state in `~/.jarvis/`. The directory and its config file are
created automatically the first time jarvis runs — no manual setup is required.

```
~/.jarvis/
  config.json
  sessions/
    <project-key>-<timestamp>.log
```

Session logs are keyed by the registered project name (the `projects` key in
`config.json`), not by absolute filesystem path. Each `jarvis run` creates one
session file and writes every log record for the lifetime of that process,
including harness status (banners, stop reasons, completion), outbound prompts,
inbound stdout/stderr, quota messages, model-configuration failures, and
interruption signals. The session log is the canonical source for reconstructing
a complete run transcript.

`config.json` schema (v1):

```ts
type AgentName = "claude" | "codex" | "cursor";

type Project = {
  root: string; // absolute path to a target-repo root
};

type Config = {
  version: 1;
  agentOrder: AgentName[];
  patchModels: Record<AgentName, string>;
  maxIterations: number; // positive integer, default 10
  logServerUrl: string; // POST endpoint used by jarvis run
  logServerBind: string; // host:port used by jarvis log-server
  worktreeSymlinks?: string[]; // relative paths from repo root to symlink into worktrees
  projects: Record<string, Project>; // key = path relative to ~/Work
};
```

#### worktreeSymlinks

The optional `worktreeSymlinks` field allows sharing build artifacts or
node_modules across worktrees without duplication. Each entry is a relative path
from the repo root. On each run, symlinks are created inside the worktree
pointing to the same paths in the main checkout.

Example:

```json
{
  "worktreeSymlinks": ["node_modules", "dist"]
}
```

This prevents redundant `bun install` or rebuild operations when re-running specs.

Default contents on first bootstrap:

```json
{
  "version": 1,
  "agentOrder": ["claude", "codex", "cursor"],
  "patchModels": {
    "claude": "haiku",
    "codex": "gpt-5.3-codex",
    "cursor": "Composer 2"
  },
  "logServerUrl": "http://127.0.0.1:4310/logs",
  "logServerBind": "127.0.0.1:4310",
  "maxIterations": 10,
  "projects": {}
}
```

All reads and writes of `~/.jarvis/` go through `src/config.ts`. Invalid configs
are rejected with an error that names the offending file.
