---
name: v2-repo-machine-profile-files
---

# Repo-committed machine profile files replace the global model config

Add `config/machines/<profile>.json` (self-contained, no layering) holding `memory` + `models` (`AgentModelConfig` shape). Add a loader that takes a profile name and reads `config/machines/<profile>.json` relative to the jarvis install root, replacing the `data/agent-model-config.json` load path for `loadAgentModelConfig`/`resolveInvocationBindings` consumers and the memory watermark. Seed `home.json` (full roster) and `work.json` (codex/cursor-heavy) with today's binding content split appropriately. Remove `data/agent-model-config.json` once migrated. Missing/malformed profile file is a hard error with a clear message. Dedupe the settle-delay default currently defined in both `machine-config-loader.ts` and `memory-watermark.ts` into one constant. Update `v2/docs/agent-model-config.md`, `v2/docs/v2-architecture.md`.

Which profile name to load is out of scope here — resolving it from operator config is [[v2-config-json-profile-and-agents]]; this slice's loader takes the profile name as a direct argument.

## Prerequisites

- `data/agent-model-config.json` and role→model resolution (`loadAgentModelConfig`, `resolveInvocationBindings`) exist.
- Memory watermark admission reads machine config today.
