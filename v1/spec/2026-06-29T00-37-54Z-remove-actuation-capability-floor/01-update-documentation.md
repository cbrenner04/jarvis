# 01 — Update documentation

## Problem

`v1/docs/config.md`, `v1/docs/agents.md`, `v1/docs/run-loop.md`, and `v2/docs/v1-behaviors.md` reference `actuationCapabilityFloor`, `capability` AgentEntry field, and `patchActuator` sub-role. After code removal these concepts no longer exist — docs must match.

## Tasks

- [ ] In `v1/docs/config.md`:
  - Remove `capability?` from the `AgentEntry` type block (line 41).
  - Remove `actuationCapabilityFloor?` from the `ModeConfig` type block (line 55).
  - Remove `patchActuator` from the `ModeConfig.subRoleAgentOrder` type block (line 51).
  - Remove `patchActuator` from the `subRoleAgentOrder` allowed-keys prose (line 305).
  - Remove `patchActuator` from the example JSON (lines 326-329).
  - Remove the entire `## modes.patch.actuationCapabilityFloor` section (lines 336-367).
- [ ] In `v1/docs/agents.md`:
  - Replace the "Patch implementation loop" bullet (lines 300-303) to state that the patch implementation loop resolves from `modes.patch.agentOrder` directly (no `patchActuator` sub-role).
- [ ] In `v1/docs/run-loop.md`:
  - Remove the capability-floor paragraph (lines 773-787).
- [ ] In `v2/docs/v1-behaviors.md`:
  - Remove the "Capability-floor filtering" entry (line 46-47).
  - Update the "Plan and patch review share..." entry (line 60) to list only `reviewPanel` and `reviewActuator` as overridable sub-roles (drop `patchActuator`).
  - Remove the "Shrink actuator capability-floor filtering" entry (line 107).

## Acceptance criteria

- [ ] `v1/docs/config.md` contains no mention of `actuationCapabilityFloor`, `patchActuator`, or `capability` on `AgentEntry`.
- [ ] `v1/docs/agents.md` references only `reviewPanel` and `reviewActuator` as sub-role overrides; `patchActuator` is absent.
- [ ] `v1/docs/run-loop.md` contains no capability-floor paragraph.
- [ ] `v2/docs/v1-behaviors.md` contains no capability-floor or `patchActuator` entries; line 60 (sub-role tiering) lists only `reviewPanel` and `reviewActuator`.

## Documentation updates

This subspec is itself the documentation update. No additional doc changes required.
