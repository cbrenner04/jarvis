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

## Schema (v1)

```ts
type AgentName = "claude" | "codex" | "cursor" | "opencode";

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

All reads and writes of `~/.jarvis/` go through `src/config.ts`. Invalid
configs are rejected with an error that names the offending file.

## Default contents

Default contents on first bootstrap:

```json
{
  "version": 1,
  "agentOrder": ["claude", "codex", "cursor"],
  "patchModels": {
    "claude": "haiku",
    "codex": "gpt-5-codex",
    "cursor": "Composer 2",
    "opencode": "github-copilot/claude-opus-4.7"
  },
  "logServerUrl": "http://127.0.0.1:4310/logs",
  "logServerBind": "127.0.0.1:4310",
  "maxIterations": 10,
  "projects": {}
}
```

`opencode` is present in `patchModels` so config validation has a complete
agent map, but `agentOrder` defaults to `["claude", "codex", "cursor"]` —
opencode is opt-in. See [agents.md](./agents.md#opencode-setup) for the
one-time permission installer and the `patchModels.opencode` `provider/model`
format.

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

## `jarvis config` subcommands

- `jarvis config show` — print the current config as JSON.
- `jarvis config path` — print the absolute path of `config.json`.
- `jarvis config set-order <a,b,c>` — replace `agentOrder` with a
  comma-separated list of agents. Rejects unknown agents and duplicates.
- `jarvis config projects` — list registered projects.
- `jarvis config remove-project <name>` — remove a registered project.
- `jarvis config edit` — open `config.json` in `$EDITOR` (fallback `vi`); the
  edited file is re-validated on save and a non-zero exit is returned if it
  is invalid.

Patch-mode model settings in `patchModels` are edited manually in
`~/.jarvis/config.json` (or via `jarvis config edit`) for now.
