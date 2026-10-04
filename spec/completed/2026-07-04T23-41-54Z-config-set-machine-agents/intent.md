---
name: config-set-machine-agents
---

# Persist v2 machine agent fallback order from the CLI

Add `jarvis config set-agents <agent,agent,...>` so the operator can replace the machine-wide fallback order without editing `~/.jarvis/v2.json` manually.

Decisions:
- `set-agents` replaces the whole `agents` list; do not add partial reorder or append/remove subcommands.
- Input syntax is agent names only; reject v1-style `agent:model` pairs.
- Write-time validation reuses the machine-config loader rules: non-empty list, strings only, no duplicates, open-set agent names.
- Updating `agents` preserves unrelated keys already present in `~/.jarvis/v2.json`; do not rewrite the file to an `agents`-only object.
- Missing parent dir or file is created on write; absence is not a blocker.
- Success prints the landed agent order on stdout; invalid input exits non-zero with a clear stderr error.
- Per-run `--agents` remains an override of the on-disk default; `set-agents` only changes persisted machine config.
- Durable operator-facing command semantics live in `v2/docs/agent-model-config.md`; `v2/docs/v2-architecture.md` only cross-links the focused show/edit surface and does not expand into broader workflow drill-down.

## Prerequisites

- Per-machine agent fallback order loads from `~/.jarvis/v2.json` with CLI `--agents` override precedence
