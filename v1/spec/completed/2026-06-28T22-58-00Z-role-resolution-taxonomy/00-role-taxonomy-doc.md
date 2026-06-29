# Role taxonomy durable doc

## Problem

v2 durable docs still resolve models through three categories (`thinking` /
`reviewing` / `executing`). Invocation already names concrete roles
(adversary, actuator, …). Categories misalign resolution keys with how agents
are actually invoked.

## Decisions

- **Durable home is `v2/docs/role-resolution.md`** — rules out folding the
  canonical `Role` union into `v2-architecture.md`, which would duplicate the
  contract the agent-model-config slice will cross-link.
- **Closed `Role` union** — `plan`, `implement`, `adversary`, `advocate`,
  `adjudicator`, `actuator`, `operator` — rules out retaining
  `thinking`/`reviewing`/`executing` as resolution keys.
- **Behaviors stay orchestration primitives** — `write`, `review-and-update`,
  `human` — rules out renaming behaviors to match roles.
- **One `actuator` role** — plan vs implement context comes from step
  metadata, not split `actuator-plan` / `actuator-implement` keys — rules out
  duplicate actuator resolution keys.
- **Shrink step binds `implement`** — post-completion shrink is `write`-loop
  implementation cleanup, not review-and-update verdict application — rules out
  mapping shrink to `actuator`, which would stretch one role across both
  behaviors and collide with `reviewActuator` → `actuator` verdict-only tier.
- **`operator` documented now, wired in Phase 9** — rules out blocking taxonomy
  on NL-router implementation.
- **Deferred to first consumer: `cheap` role** — pin when a real
  non-deterministic consumer exists; deterministic commit-message/summary work
  stays on existing paths — rules out inventing a `cheap` role in this slice.
- **Deferred to first consumer: `operator` behavior binding** — pin when Phase 9
  routes NL prompts — rules out guessing which behavior loop hosts operator
  invocations ahead of the router.
- **Deferred refresh of `v2-build-order.md`** — stale category prose refreshed
  when agent-model-config or Phase 5 implementation lands — rules out silent
  cross-doc inconsistency without claiming this slice rewrites build order.
- **No v1 config migration** — document equivalence only — rules out dual-write
  or migration tooling in this slice.

## Task checklist

- Add `v2/docs/role-resolution.md` as the canonical role taxonomy home.
- Document the closed `Role` union and one-line purpose per role.
- Document that workflow steps bind `behavior` + `prompt` + **role**; the runner
  walks per-machine agent fallback order, then resolves `(agent, role) → model`
  (inner rung details deferred to the agent-model-config slice).
- Add a role ↔ behavior reference table covering all seven roles; pin shrink as
  `implement` under `write`.
- Record the load-bearing decisions above in the doc ledger.
- Cross-link `v2/docs/v2-vision.md` (behavior vocabulary) and note that
  `AgentModelConfig` schema lands in a follow-on slice.

## Acceptance criteria

- [x] `v2/docs/role-resolution.md` exists with the closed `Role` union and a
      one-line purpose per role: `plan`, `implement`, `adversary`, `advocate`,
      `adjudicator`, `actuator`, `operator`.
- [x] The role ↔ behavior reference table has one row per role; each row names
      bound behavior(s) or notes `human` = no agent resolution and `operator` =
      behavior binding deferred to Phase 9; the shrink row binds `implement`
      under `write`.
- [x] The doc states workflow steps bind `behavior` + `prompt` + `role`; the
      runner walks per-machine agent fallback order, then resolves
      `(agent, role) → model` (inner rung detail deferred to agent-model-config
      slice).
- [x] The doc records load-bearing taxonomy decisions (categories retired;
      one `actuator`; shrink → `implement`; `operator` and `cheap` deferrals;
      `v2-build-order.md` deferral; no v1 migration).
- [x] The doc cross-links `v2/docs/v2-vision.md` and notes `AgentModelConfig`
      schema lands in a follow-on slice.
- [x] No thinking/reviewing/executing category appears as a model-resolution
      key in `role-resolution.md`. (Manual)

## Documentation updates

- `v2/docs/role-resolution.md` (new) — canonical role taxonomy and reference
  table.
