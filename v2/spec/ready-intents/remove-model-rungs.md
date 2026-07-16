---
name: remove-model-rungs
---

# Configure one model per agent role

Machine profiles currently wrap every `(agent, role)` model in a `rungs` array and
the resolver implements same-agent model escalation. The shipped profiles mostly
carry one model per role, so the extra axis obscures the actual config contract.

## Behavior

- Each machine-profile `(agent, role)` entry is one `{ adapterModel, priceKey }`
  model binding, with no `rungs` wrapper and no singleton-`rungs` compatibility
  shim left in the loader or resolver.
- Config validation requires that direct model shape and reports invalid entries
  by agent and role.
- Invocation binding resolution emits one binding per configured agent for the
  requested role, preserving outer agent order.
- Quota fallback advances to the next agent; same-agent model escalation and
  role-specific rung consumption are removed.
- Seeded `home` and `work` profiles use the direct model shape.

## Decisions

- Accept only the direct model schema — rules out maintaining a legacy `rungs` compatibility path.
- Preserve ordered agent fallback — rules out removing quota fallback together with model-rung escalation.

## Documentation updates

- `v2/docs/agent-model-config.md` — direct role-model schema, validation, binding
  resolution, quota fallback, and examples.
- Align durable v2 architecture, configuration, role-resolution, workflow, and
  invocation docs that describe inner rungs or same-agent escalation.

## Prerequisites

- Machine profiles provide role-specific model bindings for each configured agent
- Shared invocation advances across ordered bindings on quota
