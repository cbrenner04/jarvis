---
name: phase-5-role-design-gate
---

# Phase 5 design gate for role-based resolution

Update phase-tracking docs so Phase 5 (workflow runner + project config binding) is explicitly blocked until the role-based agent/model design merges. Replace remaining category wording in build-order and meta-index with role→model semantics.

## Scope

- Update `v2/docs/v2-build-order.md` Phase 5 section: role→model store, not three categories.
- Update `v2/spec/v2-meta-index.md` Phase 5 line to match and note the design dependency.

## Out of scope

- Implementing Phase 5 code.
- Changing phase ordering or scope beyond agent/model resolution wording.

## Decisions

- **Phase 5 meta-index line cites role→model store** — rules out leaving category→agent→model wording as the phase contract.
- **Meta-index notes design dependency** — Phase 5 planning should not proceed against the retired category taxonomy — rules out silent assumption that category docs still govern.

## Documentation updates

- `v2/docs/v2-build-order.md` — Phase 5 wording.
- `v2/spec/v2-meta-index.md` — Phase 5 line and design gate note.

## Prerequisites

- Role keys are documented as v2 invocation-resolution keys (replacing thinking/reviewing/executing categories).
- `AgentModelConfig` schema and per-agent per-role model escalation are documented in v2 durable docs.

## Blocker

- **`AgentModelConfig` schema and per-agent per-role model escalation not in v2 durable docs** — `v2/docs/role-resolution.md` defers them to the agent-model-config slice; `v2/docs/agent-model-config.md` is absent. Land `v2/spec/2026-06-29T01-24-52Z-agent-model-config-escalation` (or equivalent durable doc) before drafting this gate.
