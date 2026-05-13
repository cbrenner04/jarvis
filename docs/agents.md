# Agents

Reference for the agent CLIs jarvis can invoke, the flags it passes, and the
permission posture it enforces.

## Supported agents

Jarvis shells out to one underlying agent CLI per iteration. Supported agents
and the binary each one invokes:

| Agent | CLI invoked | Notes |
| --- | --- | --- |
| `claude` | `claude -p --permission-mode acceptEdits` | Prompt is piped on stdin (non-interactive print mode); `--permission-mode acceptEdits` auto-allows file edits and safe filesystem commands without prompting (`claude --help`). |
| `codex` | `codex exec --color never --sandbox workspace-write -c approval_policy="on-request"` | Prompt is piped on stdin; `--color never` disables ANSI for log-friendly text; `--sandbox workspace-write` allows writes inside the workspace and blocks network and out-of-workspace writes; `-c approval_policy="on-request"` pins approval behavior through Codex's config override channel (`codex exec --help`). |
| `cursor` | `cursor agent -p --output-format text --force --workspace <cwd> "<prompt>"` | Headless print mode; `--force` enables file writes in print mode; `--output-format text` matches transcript shape of other agents; prompt is the trailing positional argument (`cursor agent --help`). |
| `opencode` | `opencode run --model <provider/model> --format default <prompt>` | `--model` is required and read from `patchModels.opencode`; `--format default` keeps the plain-text transcript shape; prompt is the trailing positional argument. Permissions are configured via `~/.config/opencode/opencode.json` rather than a CLI flag — see [Opencode setup](#opencode-setup). |

The default fallback order is `claude → codex → cursor`. `opencode` is
supported but **opt-in** — it is not in the default `agentOrder`. Change the
order with `jarvis config set-order <a,b,c>` (see [config.md](./config.md)).
Quota detection is per-agent and based on documented or observed stderr
signals; see [quota-signals.md](./quota-signals.md).

## Agent attribution labels

Each agent exposes an `attributionLabel()` method that returns a human-readable
identifier for its configured model. This label appears in the draft PR body
footer to record which agent and model produced the work.

The label format varies per agent:

- **Known model IDs**: Mapped to family+version labels (e.g.
  `claude-opus-4-7` → `Claude Opus 4.7`).
- **Unknown model IDs**: The raw model string is returned.
- **No model configured** (agent using its default): Returns
  `<cli-name> (default model)` (e.g. `claude (default model)`).

Each agent maintains its own internal map of known model IDs, allowing the
mapping to grow independently as new models land. The map is not shared or
centralized because each agent already owns the relationship between its CLI
and the model strings that CLI accepts.

## CLI verbosity defaults

Jarvis does not strip or rewrite agent transcripts; it delegates presentation
to each upstream CLI. Current defaults:

- **Claude**: `-p` only — readable enough for the harness; avoids
  `--verbose` / `--debug` noise.
- **Codex**: `--color never` — removes escape codes so logs resemble the
  other agents' plain stdout.
- **Cursor**: `--output-format text` with `-p` — same intent as Claude's
  default print transcript (JSON/stream modes would flood logs).
- **Opencode**: `--format default` — keeps output in the plain-text
  transcript shape used by the other agents.

## Permission posture

Jarvis invokes agents with a `safe-edits` permission posture that allows:

- File reads and edits under the agent's working directory (the target repo
  root).
- Common read-only and safe filesystem operations: `mkdir`, `mv`, `cp`,
  read-only `git` (`status`, `log`, `diff`, `show`), etc.
- Prompt submission to the model within the agent's normal permission rules.

The posture **does not** allow without user confirmation:

- Network egress (`curl`, `wget`, package installs).
- Destructive commands targeting the filesystem root or home directory.
- Writes outside the target repository.

Jarvis **never** passes a provider's "bypass everything" or "dangerously skip
permissions" flags (e.g., `--dangerously-skip-permissions`,
`--force-allow-all`). Users who need to run an agent with fewer restrictions
should invoke the CLI directly. The rationale and per-provider implementation
are documented in [../spec/permissions/](../spec/permissions/).

## Opencode setup

Opencode is supported but opt-in: it is not included in the default
`agentOrder`, and its permission posture is configured in opencode's own
config file (`~/.config/opencode/opencode.json`) rather than via a CLI flag.

Before selecting opencode, run the one-time permission installer from the
jarvis checkout:

```sh
bun run install-opencode-permissions
```

That command writes the `safe-edits` permission posture to
`~/.config/opencode/opencode.json` without changing unrelated opencode
settings.

Then edit `~/.jarvis/config.json` to include opencode in `agentOrder` and set
`patchModels.opencode` to a configured `provider/model` string:

```json
{
  "agentOrder": ["opencode", "claude", "codex", "cursor"],
  "patchModels": {
    "claude": "haiku",
    "codex": "gpt-5.3-codex",
    "cursor": "Composer 2",
    "opencode": "github-copilot/claude-opus-4.7"
  }
}
```

The provider prefix is the opencode provider name, and the suffix is the
model name configured for that provider. For example,
`github-copilot/claude-opus-4.7` routes through the `github-copilot`
provider, while `AirProxy/<model>` routes through the internal AirProxy
provider. Providers are not separate jarvis agents; they are selected only
through `patchModels.opencode`.
