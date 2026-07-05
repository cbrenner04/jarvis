---
name: config-show-machine-agents
---

# Show v2 machine agent fallback config

Add read-only `jarvis config` subcommands for the v2 machine agent-order file so the operator can inspect the current default without opening JSON by hand.

Decisions:
- Namespace is `jarvis config`, not `jarvis1 config`.
- `jarvis config show` reports the current ordered `agents` list from `~/.jarvis/v2.json` or clearly indicates that no machine override is present; do not print role→model bindings or project workflow details.
- `jarvis config path` prints the machine-config path `~/.jarvis/v2.json`, not the v1 config path or the role→model data file.
- Read-only config subcommands do not change `--agents` precedence or runtime resolution.
- Durable operator-facing command semantics live in `v2/docs/agent-model-config.md`; `v2/docs/v2-architecture.md` only cross-links the focused show/edit surface and does not expand into broader workflow drill-down.

## Prerequisites

- Per-machine agent fallback order loads from `~/.jarvis/v2.json` with CLI `--agents` override precedence
