# Agents

Reference for the agent CLIs jarvis can invoke, the flags it passes, and the
permission posture it enforces.

## Supported agents

Jarvis shells out to one underlying agent CLI per iteration. Supported agents
and the binary each one invokes:

| Agent | CLI invoked | Notes |
| --- | --- | --- |
| `claude` | `claude -p --permission-mode acceptEdits` | Prompt is piped on stdin (non-interactive print mode); `--permission-mode acceptEdits` auto-allows file edits and safe filesystem commands without prompting (`claude --help`). Jarvis appends `--add-dir <path>` for each configured project sibling and external spec directory. |
| `codex` | `codex exec --color never --sandbox workspace-write -c approval_policy="on-request"` | Prompt is piped on stdin; `--color never` disables ANSI for log-friendly text; `--sandbox workspace-write` allows writes inside the workspace and blocks network and out-of-workspace writes; `-c approval_policy="on-request"` pins approval behavior through Codex's config override channel (`codex exec --help`). Jarvis appends `--add-dir <path>` for each configured project sibling and external spec directory. Token usage is **correlated from session JSONL** under `~/.codex/sessions/`: Jarvis appends a unique HTML comment marker to each prompt, snapshots session files before the invocation, and only records usage when exactly one changed session file matches that marker (and cwd metadata when present). Ambiguous or missing correlation is recorded as `usage_source: "unavailable"` rather than guessing. |
| `cursor` | `cursor agent -p --output-format text --force --workspace <cwd> "<prompt>"` | Headless print mode; `--force` enables file writes in print mode; `--output-format text` matches transcript shape of other agents; prompt is the trailing positional argument (`cursor agent --help`). Although Cursor exposes JSON and stream JSON transcript formats, token usage is not currently exposed in a stable machine-readable field for jarvis extraction, so successful cursor iterations record `usage_source: "unavailable"`. When project siblings are configured, their paths are listed in the prompt as part of the allowed project workspace, allowing Cursor to reason about cross-repo work. |
| `opencode` | `opencode run --dir <cwd> --model <provider/model> --format default <prompt>` | `--dir` is set to the working directory for the run; `--model` is required and read from the opencode entry's `model` field in `modes.patch.agentOrder`; `--format default` keeps the plain-text transcript shape; prompt is the trailing positional argument. This CLI version does not expose stable token usage for jarvis extraction, so telemetry records `usage_source: "unavailable"` for successful opencode iterations. Permissions are configured via `~/.config/opencode/opencode.json` rather than a CLI flag — see [Opencode setup](#opencode-setup). When project siblings are configured, their paths are listed in the prompt as part of the allowed project workspace, allowing Opencode to reason about cross-repo work. |
| `aider` | `aider --message "<prompt>" --model <provider/model> --yes-always --no-auto-commits --no-git --no-stream` | `--model` is required and read from the aider entry's `model` field in `modes.patch.agentOrder`; prompt is passed via `--message`; `--yes-always` keeps runs non-interactive; `--no-auto-commits` keeps jarvis as the only committer; `--no-git` prevents aider from managing the worktree's git state. Local-model runs report no per-token usage cost in jarvis telemetry (`cost_source: "no-usage"`). |

The default fallback order is `claude → codex → cursor`. `opencode` and
`aider` are supported but **opt-in** — they are not in the default
`agentOrder`. Change the order with `jarvis config set-order <a,b,c>` (see
[config.md](./config.md)).
Quota detection is per-agent and based on documented or observed stderr
signals; see [quota-signals.md](./quota-signals.md).

Jarvis normalizes the `PWD` environment variable for every spawned agent so
that agents that read `PWD` (e.g., opencode) operate on the working directory
(worktree or project root) rather than inheriting the harness's `PWD`.

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
- **Aider**: `--no-stream` — keeps output in a compact, non-streaming
  transcript shape.

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
are documented in [../spec/2026-05-11-permissions/](../spec/2026-05-11-permissions/).

## Opencode setup

Opencode is supported but opt-in: it is not included in the default
`modes.patch.agentOrder` or `modes.plan.agentOrder`, and its permission
posture is configured in opencode's own config file
(`~/.config/opencode/opencode.json`) rather than via a CLI flag.

Before selecting opencode, run the one-time permission installer from the
jarvis checkout:

```sh
bun run install-opencode-permissions
```

That command writes the `safe-edits` permission posture to
`~/.config/opencode/opencode.json` without changing unrelated opencode
settings.

Then edit `~/.jarvis/config.json` to add an opencode entry to either
`modes.patch.agentOrder` or `modes.plan.agentOrder` (or both) with a
configured `provider/model` string as its `model`:

```json
{
  "modes": {
    "patch": {
      "agentOrder": [
        { "agent": "opencode", "model": "github-copilot/claude-opus-4.7" },
        { "agent": "claude", "model": "haiku" },
        { "agent": "codex", "model": "gpt-5.3-codex" },
        { "agent": "cursor", "model": "Composer 2" }
      ]
    }
  }
}
```

The provider prefix is the opencode provider name, and the suffix is the
model name configured for that provider. For example,
`github-copilot/claude-opus-4.7` routes through the `github-copilot`
provider, while `AirProxy/<model>` routes through the internal AirProxy
provider. Providers are not separate jarvis agents; they are selected only
through the opencode entry's `model` value.

## Aider setup

Aider is supported but opt-in: it is not included in the default
`modes.patch.agentOrder` or `modes.plan.agentOrder`. Its primary use case in
jarvis is local LLM runs, where you bring your own runtime.

Worked example (Ollama):

1. Install Ollama and start it.
2. Pull a local model:

```sh
ollama pull qwen3.6:35b
```

3. Add an aider entry with an Ollama Chat model string to
   `~/.jarvis/config.json`:

```json
{
  "modes": {
    "patch": {
      "agentOrder": [
        { "agent": "aider", "model": "ollama_chat/qwen3.6:35b" },
        { "agent": "claude", "model": "haiku" },
        { "agent": "codex", "model": "gpt-5.3-codex" },
        { "agent": "cursor", "model": "Composer 2" }
      ]
    }
  }
}
```

Aider also supports hosted providers and other local runtimes such as
llama.cpp and LM Studio; see <https://aider.chat/docs/llms.html>.

## Plan-mode prompts

Plan mode (`jarvis plan`) uses the same agent contract as patch mode. Plan-mode
prompts live in `src/modes/plan/prompts/` (`interview.md`, `name-only.md`,
`draft.md`, `review.md`) and are short, focused prompts that inject intent and
guidance without requiring any non-default permission-posture changes. During
interview, the prompt directs the agent to gather user input via jarvis's
structured `question` tool. The same agents configured in
`modes.plan.agentOrder` can serve both patch and plan work.
