<<<PR_DESCRIPTION_BEGIN>>>
Plan: remove actuation-capability-floor mechanism and patchActuator sub-role

The `actuationCapabilityFloor` config, `capability` AgentEntry field, `filterAgentsByCapabilityFloor` helper, and `patchActuator` sub-role are a coupled set — removing one without the others leaves dead code or orphaned schema. Delete them end-to-end. Document `subRoleAgentOrder.reviewActuator` as the sole actuator-tiering lever.

Decisions:
- Reject `actuationCapabilityFloor`, `capability`, and `patchActuator` at config load as unknown — rules out silent strip/ignore
- Remove shrink's empty-eligible skip-path — full reviewActuator ladder always runs unconditionally
- Remove `floor-error` exit reason entirely — dead path; no telemetry mapping preserved
- Relocate non-floor tier tests from `patch-actuator-floor.test.ts` before deleting floor + `patchActuator` cases — rules out whole-file delete losing coverage
- `capability` removal is global across all `validateAgentOrder` paths, replaces plan-mode round-trip test that previously allowed it
- Scrubs floor/capability/patchActuator references across v1/docs/config.md, agents.md, run-loop.md, operator-runbook.md, and v2/docs/v1-behavings.md; adds positive reviewActuator tiering guidance
- Coordination: parallel `role-resolution-taxonomy` spec may touch v1-behaviors.md; this spec's direction (delete patchActuator) wins on merge
<<<PR_DESCRIPTION_END>>>
