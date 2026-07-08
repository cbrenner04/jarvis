---
name: daemon-binding-resolution-unification
---

# Resolve daemon agent bindings explicitly from role + machine profile

With real `claude`/`codex`/`cursor` bindings wired, the daemon no longer needs
`normalizeBindings`/`hasLiveBindings` runtime introspection to guess whether a
binding is live. Resolve bindings explicitly from `(agent, role, profile)` at
the two deserialization points (start params, queued-input rehydration)
instead, and make every daemon path call `createResolvedAgentBinding` (some
paths still call bare `createAgentBindings`). This also makes paused-run
`resume` reconstruct real bindings instead of rejecting with `not_implemented`.

## Decisions

- Delete `normalizeBindings`/`hasLiveBindings` from `daemon.ts`; bindings are
  resolved explicitly, not introspected at runtime.
- Unify all daemon binding-resolution paths on `createResolvedAgentBinding`.
- Paused-run `resume` reconstructs bindings from stored role + machine profile
  and no longer rejects with `not_implemented`.

## Prerequisites

- real `claude`, `codex`, and `cursor` bindings are wired in `shared/invocation/agents.ts`
- `resolveInvocationBindings` produces flat binding lists from machine profile + role
- paused-run `resume` currently rejects with `not_implemented` pending real bindings
