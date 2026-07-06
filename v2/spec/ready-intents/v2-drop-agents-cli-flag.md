---
name: v2-drop-agents-cli-flag
---

# Drop CLI --agents in favor of config.json agents

Remove the `--agents` flag from `jarvis write` / `jarvis run start`. Agent fallback precedence becomes: `~/.jarvis/config.json` `agents` → built-in `DEFAULT_WRITE_AGENTS` when absent. Update CLI tests and docs (`v2/docs/write-behavior.md`) for the new precedence; remove any remaining local-model/qwen terminal-fallback prose still present on `main`.

## Prerequisites

- `agents` is read from `~/.jarvis/config.json`.
