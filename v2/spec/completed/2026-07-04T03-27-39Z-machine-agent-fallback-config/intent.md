---
name: machine-agent-fallback-config
---

# Per-machine agent fallback order from v2 config

v2/src gains machine-config loading of the ordered `agents: Agent[]` outer
fallback list (availability/quota chain only — no model data), per the
storage split in `v2/docs/agent-model-config.md`. This replaces the current
CLI-only/hardcoded agent list in `write-loop-input.ts` with a config-file
source, keeping CLI override as a per-run bypass.

Decisions:
- Config is per-machine, not version-controlled, and **not** keyed by project — one `agents` list for the whole machine (agent availability/installation is a machine property, not a project property).
- On-disk file `~/.jarvis/v2.json`, shape `{ "agents": string[] }` — v2-owned, separate from v1's `~/.jarvis/config.json` schema/migrations.
- Missing file or absent top-level `agents` returns `undefined` (no override), not `[]` or an error.
- Structurally invalid config (unparseable JSON, `agents` not an array, non-string entries, duplicate names, or empty `agents`) is a hard load error — only true absence returns `undefined`.
- No validation against a fixed agent-name enum — v2 agent adapters are an open set.
- Precedence: CLI `--agents` > machine config `agents` > `DEFAULT_WRITE_AGENTS` (`["claude"]`).
- `write-loop-input.ts` stays pure (no fs I/O); `cli.ts` loads config and passes the resolved fallback in.
- Role→model bindings stay in the separate global data file (not this slice).

## Prerequisites
