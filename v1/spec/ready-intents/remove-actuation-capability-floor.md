---
name: remove-actuation-capability-floor
---

# Remove the capability-floor mechanism and patchActuator sub-role

## Problem

The operator's actual goal — let the verdict actuator skip haiku — is already
met by `modes.patch.subRoleAgentOrder.reviewActuator`. But #595/#601 also shipped
a redundant, mis-scoped `actuationCapabilityFloor`: it filters `buildActiveAgents`
(the patch impl loop) and shrink, not the verdict actuators, so it kicks haiku off
ordinary patches — the opposite of intent. The `capability` AgentEntry field and
`subRoleAgentOrder.patchActuator` key exist only to feed/name this floor.

## Direction

Delete the floor mechanism end-to-end and the `patchActuator` sub-role:

- Remove `modes.patch.actuationCapabilityFloor` config + its validation/coupling check.
- Remove the `capability` field from `AgentEntry` and its validation.
- Remove `filterAgentsByCapabilityFloor` and its call sites in `preflight.ts` and
  `shrink.ts`; patch iterations and shrink resolve their agent order with no floor.
- Remove the `patchActuator` key from `subRoleAgentOrder` (allowed keys, resolver case).
- Keep `reviewPanel` and `reviewActuator` untouched.

Observable result: configuring `actuationCapabilityFloor`, per-entry `capability`,
or `subRoleAgentOrder.patchActuator` is rejected as unknown; the patch impl loop and
shrink run their full agent order with no capability filtering.

Docs: drop the floor + patchActuator concepts from config.md / agents.md and document
`reviewActuator` as the actuator-tiering lever. Update v2/docs/v1-behaviors.md.

## Out of scope

- `reviewPanel` and `reviewActuator` sub-roles (the correct mechanism — keep).

## Prerequisites

- The reviewActuator sub-role agent-order override is implemented.
