---
name: v2-shrink-role-model-resolution
---

# `shrink` joins the closed Role union with its own rungs

`shrink` becomes a distinct model-resolution role — separate from `implement`,
with its own required `(agent, role) → rungs` entries validated at load time.

## Decisions

- `shrink` added to the closed `Role` union in `role-resolution.md` alongside
  `plan`, `implement`, `adversary`, `advocate`, `adjudicator`, `actuator`,
  `operator`.
- `shrink` is a required role for load-time validation (same hard-error family
  as other required roles), not optional like `operator`.
- `implement` keeps its existing (smaller/cheaper) rungs; `shrink` and
  `actuator` are the roles expected to carry beefier rungs — no rung-value
  policy is enforced in code, this is a config-authoring convention.
- `config/machines/*.json` must define `shrink` rungs for every agent that
  defines `implement`.
- Rung consumption mode for `shrink` is full-list (same as `implement`), not
  head-only like `actuator`.
- Docs: `role-resolution.md`, `agent-model-config.md`.

## Out of scope

- Anything that invokes `role: shrink` at runtime (separate intent).
- v1 tier parity for `patchActuator` vs `reviewActuator` beyond this split.

## Prerequisites

- Closed `Role` union and per-role load-time validation exist in `role-resolution.md` / `agent-model-config.md`.
- `config/machines/*.json` machine profiles exist and are loaded with per-role rung validation.
