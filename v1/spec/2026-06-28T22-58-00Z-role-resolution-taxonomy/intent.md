---
name: role-resolution-taxonomy
---

# Role-based model resolution taxonomy

Replace v2's three model categories (`thinking` / `reviewing` / `executing`) with **role keys** that match how agents are invoked. Behavior loops (`write`, `review-and-update`, `human`) stay orchestration primitives; workflow steps bind `behavior` + `prompt` + **role**.

Design-only slice — no config store, resolver, or workflow-runner code (Phase 5).

## Scope

- Document the `Role` union: `plan`, `implement`, `adversary`, `advocate`, `adjudicator`, `actuator`, `operator`.
- Document role ↔ behavior mapping (reference table).
- Retire category language in `v2/docs/v2-architecture.md`, `v2/docs/v2-vision.md`, and the review-debate section; cite roles instead.
- Map v1 `modes.patch.subRoleAgentOrder` tiers to v2 roles in `v2/docs/v1-behaviors.md`.
- Pin open taxonomy decisions listed below.

## Out of scope

- `AgentModelConfig` schema, escalation rungs, or data-file placement.
- Price derivation or example operator profiles.
- Phase 5 implementation, quota/subscription budget caps, v1 config migration.
- Wiring the `operator` role (Phase 9 consumer).

## Decisions

- **Behaviors stay; categories go** — resolution keys become roles; steps name a role — rules out retaining thinking/reviewing/executing as resolution keys.
- **One `actuator` role** — plan vs implement context comes from step metadata, not `actuator-plan` / `actuator-implement` split keys — rules out duplicate actuator role keys.
- **`operator` role is documented now, wired later** — Phase 9 NL router is first consumer — rules out blocking taxonomy on operator implementation.
- **Deferred to first consumer: `cheap` role** — add only when a real non-deterministic consumer exists; deterministic commit-message/summary work stays on existing paths — rules out inventing a `cheap` role in this slice.
- **No v1 config migration** — document equivalence only; v1 keeps combined `{agent, model}` `agentOrder` — rules out dual-write or migration tooling.

## Documentation updates

- `v2/docs/v2-architecture.md` — replace category→model with role→model; update layered-model table and review-debate section to cite roles.
- `v2/docs/v2-vision.md` — replace category references with roles.
- `v2/docs/v1-behaviors.md` — update v2 divergence note; map `subRoleAgentOrder` → roles.

## Prerequisites
