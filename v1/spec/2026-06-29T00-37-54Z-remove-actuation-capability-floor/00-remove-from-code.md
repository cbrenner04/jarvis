# 00 — Remove capability floor and patchActuator from source code

## Problem

The `actuationCapabilityFloor` config + `capability` AgentEntry field + `filterAgentsByCapabilityFloor` function + `patchActuator` sub-role are coupled removal targets: the floor independently filters the impl-loop (preflight via `patchActuator` resolution) and shrink (via `reviewActuator` resolution), and the `capability` field exists solely to feed the floor. Removing one without the others leaves dead code or orphaned schema.

## Decisions

- `actuationCapabilityFloor`, `capability`, and `patchActuator` are rejected at load as unknown key/field — rules out silent strip/ignore.
- `buildActiveAgents` in preflight.ts resolves directly from `cfg.modes.patch.agentOrder` instead of `resolveSubRoleAgentOrder(cfg, "patchActuator")` — removes impl-loop tiering; rules out floor-only deletion leaving sub-role.
- `iteration.ts` call sites switch to `cfg.modes.patch.agentOrder` directly.
- Shrink resolves from `resolveSubRoleAgentOrder(opts.config, "reviewActuator")` with no floor; remove empty-eligible skip-path (~438–445) so full reviewActuator ladder always runs — rules out preserving empty-post-floor behavior.
- `floor-error` exit reason removed entirely (dead path); mapping in `run-summary.ts` removed — rules out leaving dead telemetry surface.
- Test file `patch-actuator-floor.test.ts`: relocate non-floor tier tests (buildActiveAgents reviewPanel/reviewActuator resolution) to an existing test file, then delete floor + `patchActuator` cases — rules out whole-file delete losing coverage.
- Plan-mode round-trip test that allows `capability` in `config.test.ts` is replaced to reject it globally.

## Tasks

- [ ] Remove `capability` field from `AgentEntry` type and from validation in `validateAgentOrder` (all paths, not only patch).
- [ ] Add unknown-field rejection for `capability` on `AgentEntry` at config load — the field is no longer in the type/validation.
- [ ] Remove `actuationCapabilityFloor` from `ModeConfig` type and from validation (the coupling check) and serialization.
- [ ] Add unknown-key rejection for `actuationCapabilityFloor` at config load — it is no longer a recognized key.
- [ ] Remove `patchActuator` from `PatchSubRoleAgentOrder` type and `PatchSubRole` union.
- [ ] Remove `filterAgentsByCapabilityFloor` function and all its exports/imports.
- [ ] Update `buildActiveAgents` in `preflight.ts` to resolve from `cfg.modes.patch.agentOrder` directly (no floor filtering).
- [ ] Remove the empty-agents-after-floor fatal error block in `run.ts`.
- [ ] Remove the `floor-error` exit-reason path in `run.ts` and its mapping in `run-summary.ts`.
- [ ] Update `shrink.ts`: remove the `filterAgentsByCapabilityFloor` call; resolution stays via `resolveSubRoleAgentOrder(opts.config, "reviewActuator")`. Remove the empty-eligible skip-path (~438–445) so the full reviewActuator ladder runs unconditionally.
- [ ] Update `iteration.ts` call sites (~509 and ~1699) to read from `cfg.modes.patch.agentOrder` instead of `resolveSubRoleAgentOrder(cfg, "patchActuator")`.
- [ ] Remove `patchActuator` from the `allowedKeys` array in `validatePatchSubRoleAgentOrder`.
- [ ] Remove the `case "patchActuator":` branch from `resolveSubRoleAgentOrder` (leaving only `reviewPanel` and `reviewActuator` cases).
- [ ] Test relocation: move non-floor tier tests (buildActiveAgents reviewPanel/reviewActuator resolution) from `patch-actuator-floor.test.ts` to an existing test file; then delete the file with floor + `patchActuator` cases removed.
- [ ] Rewrite `patchActuator` resolver/allowed-keys tests in `config.test.ts` (~131–157, ~2441–2497) — they must reject rather than accept `patchActuator`.
- [ ] Add config-load rejection tests in `config.test.ts` for all three removed surfaces: `actuationCapabilityFloor`, `capability` on `AgentEntry`, `subRoleAgentOrder.patchActuator`.
- [ ] Remove/update floor-related test cases in `run.test.ts`: empty-eligible floor test, shrink floor-source test.
- [ ] Replace plan-mode round-trip test that allows `capability` in `config.test.ts` — it must now reject `capability` globally.
- [ ] Run `bun run typecheck` — must pass.
- [ ] Run `bun run test` — must pass.

## Acceptance criteria

- [ ] Configuring `modes.patch.actuationCapabilityFloor` in `~/.jarvis/config.json` is rejected at load with an error naming the unknown key.
- [ ] Configuring `capability` on any `AgentEntry` (not only `modes.patch.agentOrder`) is rejected at load with an error naming the unknown field.
- [ ] Configuring `modes.patch.subRoleAgentOrder.patchActuator` is rejected at load with an error naming the unknown key.
- [ ] Patch implementation loop resolves its agent order from `modes.patch.agentOrder` directly with no capability filtering; `patchActuator` sub-role no longer exists.
- [ ] Shrink resolves its agent order from `subRoleAgentOrder.reviewActuator` (fallback to `modes.patch.agentOrder`) with no floor filtering; the empty-eligible skip-path is removed — the full ladder always runs.
- [ ] `floor-error` exit reason is removed; `exitReason: "floor-error"` no longer appears in code or run summary.
- [ ] `config.test.ts` remaining tests stay green (floor/capability/patchActuator cases removed or rewritten to reject).
- [ ] `run.test.ts` remaining tests stay green (floor references removed).
- [ ] `patch-actuator-floor.test.ts` non-floor tier tests survive in their new home.

## Documentation updates

None for this subspec — documentation is in the next subspec.
