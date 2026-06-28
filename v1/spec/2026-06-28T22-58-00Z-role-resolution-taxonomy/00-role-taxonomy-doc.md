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
- **`operator` documented now, wired in Phase 9** — rules out blocking taxonomy
  on NL-router implementation.
- **Deferred to first consumer: `cheap` role** — pin when a real
  non-deterministic consumer exists; deterministic commit-message/summary work
  stays on existing paths — rules out inventing a `cheap` role in this slice.
- **Deferred to first consumer: `operator` behavior binding** — pin when Phase 9
  routes NL prompts — rules out guessing which behavior loop hosts operator
  invocations ahead of the router.
- **No v1 config migration** — document equivalence only — rules out dual-write
  or migration tooling in this slice.

## Task checklist

- Add `v2/docs/role-resolution.md` as the canonical role taxonomy home.
- Document the closed `Role` union and one-line purpose per role.
- Document that workflow steps bind `behavior` + `prompt` + **role**; the runner
  walks per-machine agent fallback order, then resolves `(agent, role) → model`
  (inner rung details deferred to the agent-model-config slice).
- Add a role ↔ behavior reference table covering all seven roles.
- Record the load-bearing decisions above in the doc ledger.
- Cross-link `v2/docs/v2-vision.md` (behavior vocabulary) and note that
  `AgentModelConfig` schema lands in a follow-on slice.

## Acceptance criteria

- [ ] `v2/docs/role-resolution.md` exists and documents the closed `Role` union:
      `plan`, `implement`, `adversary`, `advocate`, `adjudicator`, `actuator`,
      `operator`.
- [ ] The doc includes a role ↔ behavior reference table with one row per role
      and cites the three behavior primitives (`write`, `review-and-update`,
      `human`) where applicable.
- [ ] The doc records load-bearing taxonomy decisions (categories retired as
      resolution keys; one `actuator`; `operator` and `cheap` deferrals; no v1
      migration).
- [ ] `rg 'thinking|reviewing|executing' v2/docs/role-resolution.md` finds no
      category used as a model-resolution key.

## Documentation updates

- `v2/docs/role-resolution.md` (new) — canonical role taxonomy and reference
  table.
