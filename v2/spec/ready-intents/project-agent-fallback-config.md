---
name: project-agent-fallback-config
---

# Per-machine agent fallback order from project config

v2/src gains project-config loading of the ordered `agents: Agent[]` outer
fallback list (availability/quota chain only — no model data), per the
storage split in `v2/docs/agent-model-config.md`. This replaces the current
CLI-only/hardcoded agent list in `write-loop-input.ts` with a config-file
source, keeping CLI override as a per-run bypass.

Decisions:
- Config is per-machine, not version-controlled; role→model bindings stay in the separate global data file (not this slice).
- Duplicate names in project `agents` is a hard load error.
- CLI `--agents <csv>` (existing interim surface) continues to work as a per-run override of the configured order.

## Prerequisites
