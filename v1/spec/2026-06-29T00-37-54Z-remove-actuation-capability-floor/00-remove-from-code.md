# 00 — Remove capability floor and patchActuator from source code

## Problem

The `actuationCapabilityFloor` config + `capability` AgentEntry field + `filterAgentsByCapabilityFloor` function + `patchActuator` sub-role are coupled removal targets: the floor only filters agents named by the `patchActuator` sub-role, and the `capability` field exists solely to feed the floor. Removing one without the others leaves dead code or orphaned schema.

## Decisions

- `buildActiveAgents` in preflight.ts resolves directly from `cfg.modes.patch.agentOrder` instead of going through `resolveSubRoleAgentOrder(cfg, "patchActuator")`.
- `iteration.ts`'s two call sites that currently call `resolveSubRoleAgentOrder(cfg, "patchActuator")` switch to `cfg.modes.patch.agentOrder` directly.
- Shrink resolves from `resolveSubRoleAgentOrder(opts.config, "reviewActuator")` with no additional floor filtering applied.
- The empty-agents-after-floor fatal error in `run.ts` is removed (it's dead after removing the floor).
- Test file `patch-actuator-floor.test.ts` is deleted entirely.
- Floor-related test cases in `config.test.ts` and `run.test.ts` are removed.

## Tasks

- [ ] Remove `capability` field from `AgentEntry` type and from validation in `validateAgentOrder`.
- [ ] Remove `actuationCapabilityFloor` from `ModeConfig` type and from validation (the coupling check) and serialization.
- [ ] Remove `patchActuator` from `PatchSubRoleAgentOrder` type and `PatchSubRole` union.
- [ ] Remove `filterAgentsByCapabilityFloor` function.
- [ ] Update `buildActiveAgents` in `preflight.ts` to resolve from `cfg.modes.patch.agentOrder` directly (no floor filtering).
- [ ] Remove the empty-agents-after-floor fatal error block in `run.ts`.
- [ ] Update `shrink.ts` to remove the `filterAgentsByCapabilityFloor` call; resolution stays via `resolveSubRoleAgentOrder(opts.config, "reviewActuator")`.
- [ ] Update `iteration.ts` call sites (lines ~509 and ~1699) to read from `cfg.modes.patch.agentOrder` instead of `resolveSubRoleAgentOrder(cfg, "patchActuator")`.
- [ ] Remove `patchActuator` from the `allowedKeys` array in `validatePatchSubRoleAgentOrder`.
- [ ] Remove the `case "patchActuator":` branch from `resolveSubRoleAgentOrder` (leaving only `reviewPanel` and `reviewActuator` cases).
- [ ] Delete `v1/test/patch-actuator-floor.test.ts`.
- [ ] Remove floor-related test cases from `config.test.ts` (capability/floor validation tests).
- [ ] Remove floor-related test cases from `run.test.ts` (floor reference in shrink test).
- [ ] Run `bun run typecheck` — must pass.
- [ ] Run `bun run test` — must pass.

## Acceptance criteria

- [ ] Configuring `modes.patch.actuationCapabilityFloor` in `~/.jarvis/config.json` is rejected at load with an error naming the unknown key.
- [ ] Configuring `capability` on an `AgentEntry` in `modes.patch.agentOrder` is rejected at load with an error naming the unknown field.
- [ ] Configuring `modes.patch.subRoleAgentOrder.patchActuator` is rejected at load with an error naming the unknown key.
- [ ] Patch implementation loop resolves its agent order from `modes.patch.agentOrder` directly with no capability filtering.
- [ ] Shrink resolves its agent order from `subRoleAgentOrder.reviewActuator` (fallback to `modes.patch.agentOrder`) with no additional floor filtering.
- [ ] `config.test.ts` remaining tests stay green (floor/capability/patchActuator cases removed).
- [ ] `run.test.ts` remaining tests stay green (floor references removed).

## Documentation updates

None for this subspec — documentation is in the next subspec.
