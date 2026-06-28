# v1-behaviors role mapping

## Problem

`v2/docs/v1-behaviors.md` `[v2 divergence]` still documents v2's retired
category→model store. v1's `modes.patch.subRoleAgentOrder` tiers have no v2
role mapping for parity readers.

## Decisions

- **Map tiers to roles, not to categories** — rules out translating
  `subRoleAgentOrder` into thinking/reviewing/executing equivalents.
- **`reviewPanel` maps to three reviewer roles** — adversary, advocate,
  adjudicator share one config tier in v1; v2 keeps one tier binding all three
  roles — rules out splitting v1's single tier into three independent v2 config
  keys in this doc slice.
- **`patchActuator` → `implement`; `reviewActuator` → `actuator`** — rules out
  conflating patch implementation loop with review verdict actuator under one
  v2 role key.
- **Shrink step role is `implement`, not `actuator`** — v1 `reviewActuator` tier
  feeds verdict actuator (head-only) and shrink (full-list); v2 splits by step
  role — rules out mapping both consumption modes to `actuator`.
- **Document equivalence only** — v1 keeps combined `{agent, model}` `agentOrder`
  — rules out migration or dual-write guidance.

## Task checklist

- Rewrite `[v2 divergence]` under agent adapters to cite role→model resolution
  and cross-link `v2/docs/role-resolution.md`.
- Add a v1→v2 mapping table (or equivalent bullets) for
  `modes.patch.subRoleAgentOrder`:
  - `reviewPanel` → `adversary`, `advocate`, `adjudicator`
  - `patchActuator` → `implement`
  - `reviewActuator` → `actuator` (verdict actuator only)
- Document shrink step → `implement` separately from `reviewActuator` →
  `actuator`; footnote v1 tier equivalence with divergent consumption (verdict
  head-only vs shrink full-list).
- Note v1 consumption quirks that survive in v2 semantics where load-bearing
  (defer v2 config shape to agent-model-config slice).

## Acceptance criteria

- [ ] `v2/docs/v1-behaviors.md` `[v2 divergence]` bullet cites role→model
      resolution instead of category→agent→model.
- [ ] The file documents `modes.patch.subRoleAgentOrder` tier → v2 role mapping
      for `reviewPanel`, `patchActuator`, and `reviewActuator`.
- [ ] Mapping prose footnotes that `reviewActuator` tier equivalence covers
      verdict actuator (`actuator`, head-only) and shrink (`implement`,
      full-list fallback).
- [ ] The file cross-links `v2/docs/role-resolution.md`.
- [ ] No v1 migration or dual-write guidance appears in the updated prose.

## Documentation updates

- `v2/docs/v1-behaviors.md` — v2 divergence note; `subRoleAgentOrder` → roles
  mapping.
