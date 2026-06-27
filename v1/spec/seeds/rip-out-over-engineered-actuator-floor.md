---
name: rip-out-over-engineered-actuator-floor
---

# Rip out the over-engineered actuator tiering — reviewActuator override is the whole fix

## Problem

The goal was simple: let the operator make the **verdict actuator** (the
code-writer at the end of a review loop: adversary → advocate → adjudicator →
**actuator**) skip haiku. That goal is fully met by one config lever:
`modes.patch.subRoleAgentOrder.reviewActuator`.

But it shipped over-engineered into 2–3 separate mechanisms this session
(#595 + #601), one of which is also **mis-scoped**:

1. **`actuationCapabilityFloor` + per-entry `capability` rank (#595)** — a whole
   numeric-floor mechanism that is **mis-scoped**: it filters
   `buildActiveAgents` (`v1/src/modes/patch/preflight.ts:342`, the **patch impl
   loop**) and shrink — **not** the verdict actuators. So "actuation floor"
   actually floors **every patch iteration**, kicking haiku off ordinary patches,
   which is the opposite of intent. Redundant *and* wrong.
2. **`subRoleAgentOrder.patchActuator`** — names the patch **impl loop** an
   "actuator," conflating it with the verdict actuator. The impl loop is just
   `modes.patch.agentOrder`; calling it `patchActuator` is what made the floor
   mis-scope so easy to miss.
3. (The `capability` field on `AgentEntry` exists only to feed the floor.)

The actually-useful sub-roles — `reviewPanel` (read-only review roles) and
`reviewActuator` (verdict actuator + shrink) — are correct; keep them.

## Direction

Simplify to the one lever that works:

- **Remove** `actuationCapabilityFloor`, the `capability` `AgentEntry` field, the
  floor filter (`filterAgentsByCapabilityFloor` and its call sites in
  `preflight.ts`/`shrink.ts`), and the `subRoleAgentOrder.patchActuator` key.
- **Keep** `subRoleAgentOrder.reviewPanel` and `subRoleAgentOrder.reviewActuator`
  as the tiering levers. "Skip haiku on the actuator" = set `reviewActuator` to
  an order without haiku. No floor needed.
- Update `config.md` / `agents.md` to drop the floor + patchActuator concepts and
  document `reviewActuator` as the actuator-tiering lever.

## Out of scope

- `reviewPanel` and `reviewActuator` sub-roles (these are the correct mechanism).

## References

- Shipped this session: capability floor (#595), sub-role tiering (#601).
- Mis-scoped floor: `v1/src/modes/patch/preflight.ts:342` (`buildActiveAgents`),
  `v1/src/config.ts` `filterAgentsByCapabilityFloor`.
