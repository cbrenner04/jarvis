# 01 — Update documentation

## Problem

`v1/docs/config.md`, `v1/docs/agents.md`, `v1/docs/run-loop.md`, `v1/docs/operator-runbook.md`, and `v2/docs/v1-behaviors.md` reference `actuationCapabilityFloor`, `capability` AgentEntry field, `patchActuator` sub-role, or floor-filtering behavior. After code removal these concepts no longer exist — docs must match. The intent also requires documenting `reviewActuator` as the actuator-tiering lever.

## Tasks

- [ ] In `v1/docs/config.md`:
  - Remove `capability?` from the `AgentEntry` type block.
  - Remove `actuationCapabilityFloor?` from the `ModeConfig` type block.
  - Remove `patchActuator` from the `ModeConfig.subRoleAgentOrder` type block.
  - Remove `patchActuator` from the `subRoleAgentOrder` allowed-keys prose.
  - Remove `patchActuator` from the example JSON.
  - Remove the entire `## modes.patch.actuationCapabilityFloor` section.
  - Add `reviewActuator` tiering guidance: document that `subRoleAgentOrder.reviewActuator` is the mechanism to restrict which agents serve as review actuators.
- [ ] In `v1/docs/agents.md`:
  - Replace "Patch implementation loop" bullet to state the loop resolves from `modes.patch.agentOrder` directly (no `patchActuator` sub-role).
  - Add a bullet documenting `reviewActuator` as the actuator-tiering lever: agents listed in `subRoleAgentOrder.reviewActuator` are the only ones used for review actuator turns; all others are skipped.
- [ ] In `v1/docs/run-loop.md`:
  - Remove the capability-floor paragraph.
  - Remove residual "floor" prose (~lines 791, 799).
- [ ] In `v1/docs/operator-runbook.md`:
  - Remove "tier/floor/override" prose (~line 320) referencing capability floor.
- [ ] In `v2/docs/v1-behaviors.md`:
  - Remove "Capability-floor filtering" entry.
  - Remove pool-contention bullet (~line 47) that references floor.
  - Update "Plan and patch review share..." entry to list only `reviewPanel` and `reviewActuator` as overridable sub-roles (drop `patchActuator`).
  - Remove "Shrink actuator capability-floor filtering" entry.
  - Add entry documenting `reviewActuator` as the sole actuator-tiering lever.

## Acceptance criteria

- [ ] `v1/docs/config.md` contains no mention of `actuationCapabilityFloor`, `patchActuator`, or `capability` on `AgentEntry`; contains positive `reviewActuator` tiering guidance.
- [ ] `v1/docs/agents.md` references only `reviewPanel` and `reviewActuator` as sub-role overrides; `patchActuator` is absent; `reviewActuator` is documented as the actuator-tiering lever.
- [ ] `v1/docs/run-loop.md` contains no capability-floor or residual floor references.
- [ ] `v1/docs/operator-runbook.md` contains no capability-floor references.
- [ ] `v2/docs/v1-behaviors.md` contains no capability-floor, `patchActuator`, or pool-contention-floor entries; lists only `reviewPanel` and `reviewActuator` as sub-role tiering surfaces; documents `reviewActuator` as the sole actuator-tiering lever.

## Documentation updates

This subspec is itself the documentation update. No additional doc changes required.

## Coordination note

Parallel spec `role-resolution-taxonomy` may touch `v1-behaviors.md`. Merge order or reconcile when both land; this spec's direction (delete `patchActuator`) should win.
