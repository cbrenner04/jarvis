# Configuration

Jarvis keeps its state in `~/.jarvis/`. The directory and its config file are
created automatically the first time jarvis runs — no manual setup is
required.

```text
~/.jarvis/
  config.json
  sessions/
    <project-key>:<spec-name>-<timestamp>.log
```

Session logs are keyed by the registered project name (the `projects` key in
`config.json`) plus the spec display name, not by absolute filesystem path.
Each `jarvis run` creates one session file and writes every log record for
the lifetime of that process. See [run-loop.md](./run-loop.md#output-destinations)
for the difference between the session log, the run terminal, and the log
server.

## Schema (v2)

```ts
type AgentName = "claude" | "codex" | "cursor" | "opencode";

type Project = {
  root: string; // absolute path to a target-repo root
  origin?: string; // optional git remote URL recorded by `jarvis init`
  git?: boolean; // optional per-project override of the top-level `git` toggle
};

type ModeConfig = {
  agentOrder: AgentName[];
};

type Config = {
  version: 2;
  modes: {
    patch: ModeConfig; // agent order for `jarvis run` (patch mode)
    plan: ModeConfig; // agent order for `jarvis plan` (plan mode)
  };
  quotaFallback: "strict" | "lenient"; // weak quota-like error fallback mode; default "lenient"
  weakQuotaExitCodes: number[]; // exit codes treated as probable-quota under lenient mode; default []
  patchModels: Record<AgentName, string>;
  maxIterations: number; // positive integer, default 10
  iterationTimeoutMs: number; // per-iteration timeout in milliseconds, default 30 minutes (1_800_000)
  runTimeoutMs?: number; // optional global run timeout in milliseconds; unset by default
  logServerUrl: string; // POST endpoint used by jarvis run
  logServerBind: string; // host:port used by jarvis log-server
  telemetryPath: string | null; // JSONL path for per-iteration/terminal run telemetry; null disables
  worktreeSymlinks?: string[]; // relative paths from repo root to symlink into worktrees
  git: boolean; // whether jarvis manages git/gh (worktree, commits, PR); default true
  projects: Record<string, Project>; // key = path relative to ~/Work
};
```

All reads and writes of `~/.jarvis/` go through `src/config.ts`. Invalid
configs are rejected with an error that names the offending file.

## `Project.origin`

`jarvis init` records each project's `origin` remote URL by running `git
remote get-url origin` in the registered repo and storing the trimmed
output in `projects[<name>].origin`. The string is stored verbatim — no URL
normalization is performed at write time. If the repo has no `origin`
remote, init still succeeds and the field is omitted with a one-line note.

Legacy configs without `origin` continue to load. On `jarvis run`, if the
resolved project's record is missing `origin`, jarvis attempts to populate
it from the project's `root` and persists the update. Failures here do not
block the run.

## Default contents

Default contents on first bootstrap:

```json
{
  "version": 2,
  "modes": {
    "patch": {
      "agentOrder": ["claude", "codex", "cursor"]
    },
    "plan": {
      "agentOrder": ["claude", "codex", "cursor"]
    }
  },
  "quotaFallback": "lenient",
  "weakQuotaExitCodes": [],
  "patchModels": {
    "claude": "haiku",
    "codex": "gpt-5.3-codex",
    "cursor": "Composer 2",
    "opencode": "github-copilot/claude-opus-4.7"
  },
  "logServerUrl": "http://127.0.0.1:4310/logs",
  "logServerBind": "127.0.0.1:4310",
  "telemetryPath": "~/.jarvis/runs.jsonl",
  "maxIterations": 10,
  "iterationTimeoutMs": 1800000,
  "git": true,
  "projects": {}
}
```

`opencode` is present in `patchModels` so config validation has a complete
agent map, but both `modes.patch.agentOrder` and `modes.plan.agentOrder` default
to `["claude", "codex", "cursor"]` — opencode is opt-in. See
[agents.md](./agents.md#opencode-setup) for the one-time permission installer
and the `patchModels.opencode` `provider/model` format.

## `worktreeSymlinks`

The optional `worktreeSymlinks` field allows sharing build artifacts or
`node_modules` across worktrees without duplication. Each entry is a relative
path from the repo root. On each run, symlinks are created inside the
worktree pointing to the same paths in the main checkout.

Example:

```json
{
  "worktreeSymlinks": ["node_modules", "dist"]
}
```

This prevents redundant `bun install` or rebuild operations when re-running
specs.

## `git` toggle

The top-level `git` boolean controls whether jarvis manages git and GitHub
on behalf of a run — creating a worktree, committing per subspec, pushing,
and opening a draft PR. It defaults to `true` to preserve historic behavior.

Each project may override the top-level value with an optional
`projects[<name>].git` boolean. The effective value is the project override
when defined, otherwise the top-level value, otherwise `true` for configs
written before this field existed.

The behavior that flips when `git` is `false` (no worktree, no commits, no
PR, alternative completion semantics, `--cwd`) is implemented separately and
documented alongside `jarvis run`.

## `jarvis config` subcommands

- `jarvis config show` — print the current config as JSON, including both
  `modes.patch.agentOrder` and `modes.plan.agentOrder`.
- `jarvis config path` — print the absolute path of `config.json`.
- `jarvis config set-patch-order <a,b,c>` — replace `modes.patch.agentOrder`
  with a comma-separated list of agents. Rejects unknown agents and duplicates.
- `jarvis config set-plan-order <a,b,c>` — replace `modes.plan.agentOrder`
  with a comma-separated list of agents. Rejects unknown agents and duplicates.
- `jarvis config set-git <true|false>` — write the top-level `git` toggle.
- `jarvis config set-project-git <name> <true|false|unset>` — write or
  clear the per-project `git` override. Unknown project names exit 1.
- `jarvis config projects` — list registered projects.
- `jarvis config remove-project <name>` — remove a registered project.
- `jarvis config edit` — open `config.json` in `$EDITOR` (fallback `vi`); the
  edited file is re-validated on save and a non-zero exit is returned if it
  is invalid.

Patch-mode model settings in `patchModels` are edited manually in
`~/.jarvis/config.json` (or via `jarvis config edit`) for now.
