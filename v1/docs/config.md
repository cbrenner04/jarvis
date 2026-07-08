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
  siblings?: string[]; // optional array of absolute paths to sibling repositories
  plan?: { specTimestamp?: boolean; commit?: boolean; targetDir?: string }; // optional per-project plan-mode overrides
  updateSnapshotsCommand?: string; // optional update-snapshots command for the snapshot-churn blocker gate
  readyCommand?: string; // optional per-project ready command override
  fixCommand?: string; // optional per-project autofix command override
  readyGateRetryBound?: number; // optional per-project completion ready-gate retry bound (default 2)
  installCommand?: string; // optional install command for dependency installation (default "bun install")
};

type AgentEntry = {
  agent: AgentName;
  model: string; // CLI/account-specific model identifier
};

type ModeConfig = {
  agentOrder: AgentEntry[];
  prNarrative?: "template" | "agent"; // PR narrative mode: default "template"
  shrink?: "off" | "agent"; // patch mode only: whether to run shrink phase (default "agent")
  subRoleAgentOrder?: {
    reviewPanel?: AgentEntry[];
    reviewActuator?: AgentEntry[];
  }; // patch mode only: optional per-sub-role agent-order overrides
  commit?: boolean; // plan mode only: whether to commit specs to the target repo (default true)
  targetDir?: string; // plan and intent modes: relative path where committed specs are routed (default "spec")
};

// For modes.prompt specifically, only agentOrder is used. The commit and targetDir fields have no effect.

type ReviewModeConfig = {
  agentOrder?: AgentEntry[]; // optional; falls back to modes.plan.agentOrder if unset
  passes: number; // non-negative integer: 0 disables review, 1+ enables N review passes; default 1
};

type Config = {
  version: 2;
  modes: {
    patch: ModeConfig; // agent order + per-agent models for `jarvis run` (patch mode)
    plan: ModeConfig; // agent order + per-agent models for `jarvis plan` intent-refinement, draft, and review phases (including resume)
    prompt: ModeConfig; // agent order + per-agent models for `jarvis prompt` single-pass invocation (prompt mode)
    review: ReviewModeConfig; // agent order (optional, fallback to plan) and pass count for patch review loop
  };
  quotaFallback: "strict" | "lenient"; // weak quota-like error fallback mode; default "lenient"
  weakQuotaExitCodes: number[]; // exit codes treated as probable-quota under lenient mode; default []
  maxIterations: number; // positive integer, default 10
  iterationTimeoutMs: number; // per-iteration timeout in milliseconds, default 10 minutes (600_000)
  idleOutputTimeoutMs?: number; // optional idle-output timeout in milliseconds; unset by default (disabled)
  runTimeoutMs?: number; // optional global run timeout in milliseconds; unset by default
  logServerUrl: string; // POST endpoint used by jarvis run
  logServerBind: string; // host:port used by jarvis log-server
  telemetryPath: string | null; // JSONL path for per-iteration/terminal run telemetry; null disables
  worktreeSymlinks?: string[]; // relative paths from repo root to symlink into worktrees
  git: boolean; // whether jarvis manages git/gh (worktree, commits, PR); default true
  projects: Record<string, Project>; // key = path relative to ~/Work
};
```

**Project object keys are validated strictly:** only `root`, `origin`, `git`, `siblings`, `plan`, `updateSnapshotsCommand`, `readyCommand`, `fixCommand`, `readyGateRetryBound`, and `installCommand` are allowed. Unknown keys (including a flat `specTimestamp` or `commit` at the project level instead of nested under `plan`) cause `loadConfig` to throw with a descriptive error. This catches misconfigurations early.

**`updateSnapshotsCommand`** (per-project, optional): the command the snapshot-churn blocker gate runs to refresh outdated snapshots before re-testing (e.g. `bun test --update-snapshots`, `vitest -u`, `jest -u`). Takes precedence over auto-detection from the target repo's root `package.json`; if neither is set, the gate fail-safes (the blocker stands). Used only by that gate.

**`readyCommand`** (per-project, optional): overrides the **verification** command at all patch-mode ready gate sites (completion transition, pre-shrink, review baseline, review final, and `maybeMarkReady`). Value is tokenized on whitespace and run via `execFileSync` (no shell). Must be a non-empty, non-whitespace-only string; rejected at `loadConfig` otherwise. Receives the `JARVIS_READY_TIER` env var (`"fast"` or `"full"`) unchanged. When unset, verification falls back to `bun run ready`. The override is verification-only: on a `full` gate the harness runs the project's `fixCommand` (or built-in `bun run fix` when unset) and commits any dirty output before invoking the override, then commits any post-verification churn after green verification when porcelain is non-empty; residual still-dirty porcelain after that commit aborts (no second harness fix pass). Mutating `readyCommand` side effects are harness-owned committable churn on `full`.

**`fixCommand`** (per-project, optional): overrides the **autofix** command on `full`-tier ready gates (completion transition, pre-shrink, review baseline and final, `maybeMarkReady`, triage `--mark-ready` / `--merge`, and plan-mode draft→ready). Tokenized on whitespace and run via `execFileSync` (no shell). Must be a non-empty, non-whitespace-only string; rejected at `loadConfig` otherwise. When unset, autofix falls back to `bun run fix`. For package-manager-shaped commands (`bun`/`npm`/`pnpm`/`yarn run <script>`), the harness skips autofix when root `package.json` is missing, unreadable, or lacks that script — verification and commit-if-dirty still run. Non-bun repos or repos without a `fix` script must set `fixCommand` (or accept absent-script skip on the default). Verification stays on `readyCommand` / `bun run ready`; do not fold autofix into `readyCommand`.

**`readyGateRetryBound`** (per-project, optional): sets the completion ready gate's retry bound (number of retries before entering fix-up, not counting the initial attempt). A non-negative integer; default is 2 (meaning 3 total attempts). Value 0 runs once and enters fix-up immediately on retryable red. Applies only to the completion-transition ready gate (the only ready gate with a retry loop); other ready gates always run once. Absent the knob, behavior is unchanged (2 retries).

**`installCommand`** (per-project, optional): the command the harness runs to install dependencies when `package.json` or `bun.lock` changes during an iteration (e.g. `bun install`, `npm ci`, `yarn install`). Defaults to `bun install` when unset. The command is run outside the agent sandbox with network access available, in the worktree directory. If the install fails, the failure is logged but does not halt the run. Value is tokenized on whitespace and run via shell (`sh -c`).

All reads and writes of `~/.jarvis/` go through `src/config.ts`. Invalid
configs are rejected with an error that names the offending file.

## Prompt mode

Prompt mode (`jarvis1 prompt`) is a single-pass agent invocation mode configured by `modes.prompt.agentOrder`. If `modes.prompt` is not specified in the config, it defaults to a copy of `modes.patch.agentOrder` at load time.

The `modes.prompt` mode config accepts only `agentOrder`; the optional `commit` and `targetDir` fields (used in plan mode) have no effect in prompt mode. See [specless-prompt.md](./specless-prompt.md) for full prompt-mode documentation.

## `modes.plan.commit`

The optional `modes.plan.commit` boolean (default `true`) controls where plan-mode specs are authored and whether git/GitHub participation is enabled:

**`true` (default):** Plan specs are authored inside the target repository under `spec/<spec-dir>/` on a git branch. Fresh seeded runs commit `plan: intent` (and `plan: refine` when `--refine-turns > 0`), open or update a draft PR, and exit with `--resume-draft` handoff; draft/review continue after that resume. `gh pr ready` runs programmatically when every phase succeeds. See [plan-mode.md](./plan-mode.md#committed-fresh-run-handoff-after-refine).

**`false`:** Plan specs are authored in Jarvis-owned storage at `~/.jarvis/specs/<project-safe-id>/<spec-dir>/` outside the target repository. No git worktree, branch, commits, or PR are created. Plan mode runs directly in the target repo root. The generated spec includes a `repo:` binding so `jarvis run` can resolve the target repository later. Use this mode when specs should not be committed to the repo or when you want to generate and immediately execute a spec without the PR review cycle.

Re-runs of incomplete external specs are self-cleaning: acceptance criteria ticked in prior incomplete runs are automatically un-ticked before the next agent invocation, and any appended blockers are stripped — no manual cleanup needed.

`jarvis1 cleanup` still removes the merged git worktree for a `commit:false` implementation branch, but archives the spec from the external home instead: `~/.jarvis/specs/<project-safe-id>/<name>/` moves to `~/.jarvis/specs/<project-safe-id>/completed/<name>/`, and `ready-intents/<branch-slug>.md` is pruned when present. This external archive is a plain filesystem move; no git commit is created.

## Plan CLI flags (not in config)

`--review-passes` is a per-invocation CLI flag only; it is not stored in `config.json`. `--review-passes` defaults to `modes.review.passes` (currently `1`). Full semantics: [plan-mode.md](./plan-mode.md#flags).

## `targetDir` (plan mode, commit=true only)

The optional `targetDir` setting (default `"spec"`) specifies the relative path from the repository root where committed plan specs are written.

**In `modes.plan`:** Sets the global default for all repositories that do not have a per-project override.

**In `projects[<name>].plan`:** Overrides the global default for a specific repository.

**Constraints:**
- Must be a relative path (not absolute).
- Must not begin with `..` (no parent directory access).
- The default `"spec"` routes new plans to `spec/<timestamp>-<name>/`, the canonical layout documented in [spec-guidance.md](./spec-guidance.md).

**Example:** To route a repository's new plans to `v1/spec/` instead of the default `spec/`:

```json
{
  "projects": {
    "jarvis": {
      "root": "/path/to/jarvis",
      "plan": {
        "targetDir": "v1/spec"
      }
    }
  }
}
```

With this configuration, `jarvis1 plan` creates commits under `v1/spec/<timestamp>-<plan-name>/` instead of `spec/<timestamp>-<plan-name>/`.

`jarvis1 plan --target-dir <dir>` provides a per-run override with higher precedence than config:
`--target-dir` > `projects[<name>].plan.targetDir` > `modes.plan.targetDir` > `"spec"`.
The flag uses the same validation as config (`relative` path, no `..` traversal).

**Hand-editing:** Edit `~/.jarvis/config.json` directly, or use `jarvis config edit` to open the config in `$EDITOR`.

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

## Operator runbook scaffolding

`jarvis init` scaffolds an `OPERATOR_RUNBOOK.md` file at the project root
when the file is absent. The runbook is a persistent guide combining init-time
facts (repo path, origin URL, inferred stack) with seeded config values
(`readyCommand`, agent order, modes) and stubbed sections for operator
fill-in (manual finalize procedures, recovery by exit reason, resume guidance,
gate blind spots, cross-repo coordination).

The runbook is not overwritten on re-run of `jarvis init` on the same
project, preserving operator-authored customization. The file's existence
is checked once per init run; the runbook is created only if absent. Fixed
section headings (exact text and order) make the document structural contract:
other tools and documentation may reference sections by name.

## Default contents

Default contents on first bootstrap:

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
    "plan": {
      "agentOrder": [
        { "agent": "claude", "model": "haiku" },
        { "agent": "codex", "model": "gpt-5.3-codex" },
        { "agent": "cursor", "model": "Composer 2" }
      ],
      "targetDir": "spec"
    },
    "prompt": {
      "agentOrder": [
        { "agent": "claude", "model": "haiku" },
        { "agent": "codex", "model": "gpt-5.3-codex" },
        { "agent": "cursor", "model": "Composer 2" }
      ]
    },
    "review": {
      "passes": 2
    }
  },
  "quotaFallback": "lenient",
  "weakQuotaExitCodes": [],
  "logServerUrl": "http://127.0.0.1:4310/logs",
  "logServerBind": "127.0.0.1:4310",
  "telemetryPath": "~/.jarvis/runs.jsonl",
  "maxIterations": 10,
  "iterationTimeoutMs": 600000,
  // "idleOutputTimeoutMs": 60000,  // optional: abort iteration if no output for 60 seconds
  "git": true,
  "projects": {}
}
```

Both `modes.patch.agentOrder` and `modes.plan.agentOrder` default to
`claude`, `codex`, and `cursor` — opencode is opt-in. To enable it, add an
`opencode` entry to either order with a `provider/model` string as its
`model`. See [agents.md](./agents.md#opencode-setup) for the one-time
permission installer and the `provider/model` format.

## `modes.review.passes` and `modes.review.agentOrder`

The `modes.review` block controls review passes in both `jarvis run` (patch review) and `jarvis1 plan` (self-review):

**`passes` (non-negative integer, default `1`):** Controls the number of review passes after patch iteration completes. A value of `0` disables review entirely. Each pass runs the configured review agent(s) against the completed work.

**`agentOrder` (optional):** Agent order for review passes. If unset, review uses `modes.plan.agentOrder`. Like `modes.patch.agentOrder` and `modes.plan.agentOrder`, each entry is `{ "agent": "...", "model": "..." }` and the same `validateAgentOrder` contract applies: no duplicate agents, agents must be known, and models must be valid for the agent.

**Model tiering for read-only review roles:** The `modes.review.agentOrder` configuration is commonly used to assign faster, cheaper models to read-only review roles (adversary, advocate, adjudicator) while keeping implementation-grade models on the code-writing actuators (review actuator and shrink agent). The review roles use `modes.review.agentOrder` falling back to `modes.plan.agentOrder`, while the actuators use `modes.patch.agentOrder` regardless of the review order setting. This lets you run all-Haiku review while using Opus for implementation, trading review latency and cost for slightly lower defect-catch rate. See [agents.md § Review/shrink model tiering](./agents.md) for the full tiering guidance, cost/quality tradeoffs, and cross-mode coupling notes.

Example configuration enabling review with a custom agent order:

```json
{
  "modes": {
    "review": {
      "passes": 2,
      "agentOrder": [
        { "agent": "claude", "model": "haiku" },
        { "agent": "codex", "model": "gpt-5.3-codex" }
      ]
    }
  }
}
```

The `--review-passes` CLI flag overrides config for both patch and plan review:
`jarvis run --review-passes 0 <spec>` disables patch review without changing config, while `jarvis1 plan --review-passes 3 …` runs 3 plan self-review passes instead of the configured number.

Repeatable `--agent <name>[:<model>]` on `jarvis1 run`, `jarvis1 plan`, or `jarvis1 intent` replaces the in-memory mode `agentOrder` for that invocation only; persisted config is unchanged. See [agents.md](./agents.md#per-run---agent-override).

When `git: false`, patch review is skipped entirely regardless of review-pass configuration.

## `modes.patch.shrink`

The optional `modes.patch.shrink` field (default `"agent"`) controls whether the post-completion shrink phase runs during `jarvis run`:

**`"agent"` (default):** The shrink phase runs when at least one implementation iteration completes on a repo with `git: true`. The agent shrinks changes to the minimum set of touched files and commits the result.

**`"off"`:** The shrink phase is skipped entirely. No agent shrink runs, no pre-shrink ready gate fires, and no shrink-phase telemetry is emitted. Review placement and `maybeMarkReady` behavior are unchanged.

Use `shrink: "off"` during fast inner-loop development to skip time-consuming shrink iterations — `modes.review.passes: 0` stops review; `modes.patch.shrink: "off"` stops shrink separately.

Example configuration to disable shrink for a project:

```json
{
  "modes": {
    "patch": {
      "agentOrder": [
        { "agent": "claude", "model": "haiku" }
      ],
      "shrink": "off"
    }
  }
}
```

## `modes.patch.subRoleAgentOrder`

The optional `modes.patch.subRoleAgentOrder` block adds per-sub-role agent-order overrides within `jarvis run`. When the block or an individual key is unset, resolution stays at today's behavior.

Allowed keys:

- `reviewPanel`: read-only review roles (`adversary`, `advocate`, `adjudicator`)
- `reviewActuator`: verdict actuator (quota and initial binding head-only; idle escalation walks the full list) and shrink agent (full list). Actuator-tiering lever — only listed agents run review actuator and shrink; unset falls back to `modes.patch.agentOrder`.

Each present key uses the same `AgentEntry[]` schema and validation contract as `modes.patch.agentOrder`: the array must be non-empty, agents must be known, agents must not repeat, and each model must be valid for its agent. Unknown keys under `subRoleAgentOrder` are rejected at config load.

Example:

```json
{
  "modes": {
    "patch": {
      "agentOrder": [
        { "agent": "claude", "model": "sonnet" },
        { "agent": "codex", "model": "gpt-5.4" }
      ],
      "subRoleAgentOrder": {
        "reviewPanel": [
          { "agent": "claude", "model": "haiku" }
        ],
        "reviewActuator": [
          { "agent": "codex", "model": "gpt-5.4" }
        ]
      }
    }
  }
}
```

## Unknown top-level keys

Top-level keys outside this schema (reserved for v2, e.g. `machineProfile`,
`agents`) are preserved unchanged across v1 config writes — v1 does not
validate or interpret them.

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

## `Project.siblings`

The optional `siblings` field declares sibling repositories that are part of
the same unit of work as the primary project. When a spec routed through one
repository needs changes in another, siblings make those directories accessible
to agents during `jarvis run`.

### Validation rules

- `siblings` is an optional array of absolute paths.
- Each entry must be a non-empty string (no whitespace-only values).
- Each entry must be an absolute path; relative paths are rejected with a
  descriptive error.
- All configured sibling paths must exist on disk at run time. If any sibling
  path is missing, `jarvis run` exits with an error naming the project and the
  missing path.
- Empty `siblings` arrays (`[]`) are treated identically to omitting the field.

### Example

For a multi-repo workspace like:

```text
~/Work/groceries/
  groceries_features/    ← primary project (registered)
  groceries-client/      ← sibling
  groceries-service/     ← sibling
```

Register `groceries_features` with:

```json
{
  "projects": {
    "groceries": {
      "root": "/Users/you/Work/groceries/groceries_features",
      "siblings": [
        "/Users/you/Work/groceries/groceries-client",
        "/Users/you/Work/groceries/groceries-service"
      ]
    }
  }
}
```

When `jarvis run` executes a spec for the `groceries` project, all agents
receive the sibling paths in their prompt and as accessible workspace roots.
Agents can read from and edit files in any sibling directory as if they were
part of the primary project.

### Hand-editing `~/.jarvis/config.json`

To add siblings to an existing project, edit `~/.jarvis/config.json` directly:

```json
{
  "projects": {
    "groceries": {
      "root": "/Users/you/Work/groceries/groceries_features",
      "siblings": ["/Users/you/Work/groceries/groceries-client"]
    }
  }
}
```

Paths must be absolute. Non-absolute paths cause validation to fail with a
clear error message.

## Common misconfigurations

**Flat `specTimestamp` or `commit` at the project level:**

The `specTimestamp` and `commit` flags are **plan-mode overrides** and must be nested under the `plan` object:

```json
{
  "projects": {
    "myrepo": {
      "root": "/path/to/repo",
      "plan": {
        "specTimestamp": true,
        "commit": false
      }
    }
  }
}
```

❌ **Incorrect** (will cause a validation error):

```json
{
  "projects": {
    "myrepo": {
      "root": "/path/to/repo",
      "specTimestamp": true,
      "commit": false
    }
  }
}
```

If you accidentally place `specTimestamp` or `commit` flat on a project, `loadConfig` will throw an error naming the key and suggesting the correct nesting (`plan.specTimestamp` or `plan.commit`).

## `jarvis config` subcommands

- `jarvis config show` — print the current config as JSON, including both
  `modes.patch.agentOrder` and `modes.plan.agentOrder`.
- `jarvis config path` — print the absolute path of `config.json`.
- `jarvis config set-patch-order <agent:model,agent:model,...>` — replace
  `modes.patch.agentOrder`. Each comma-separated entry is `agent:model`
  (e.g. `claude:haiku,codex:gpt-5.3-codex`). Rejects unknown agents,
  duplicates, missing colons, and empty models.
- `jarvis config set-plan-order <agent:model,agent:model,...>` — replace
  `modes.plan.agentOrder`. Same syntax as `set-patch-order`.
- `jarvis config set-prompt-order <agent:model,agent:model,...>` — replace
  `modes.prompt.agentOrder`. Same syntax as `set-patch-order`.
- `jarvis config set-git <true|false>` — write the top-level `git` toggle.
- `jarvis config set-project-git <name> <true|false|unset>` — write or
  clear the per-project `git` override. Unknown project names exit 1.
- `jarvis config projects` — list registered projects.
- `jarvis config remove-project <name>` — remove a registered project.
- `jarvis config edit` — open `config.json` in `$EDITOR` (fallback `vi`); the
  edited file is re-validated on save and a non-zero exit is returned if it
  is invalid.

Per-agent models live inline on each `agentOrder` entry. Use the
`set-patch-order` / `set-plan-order` subcommands above to replace the whole
order with new `agent:model` pairs, or `jarvis config edit` to adjust an
individual `model` field by hand.
