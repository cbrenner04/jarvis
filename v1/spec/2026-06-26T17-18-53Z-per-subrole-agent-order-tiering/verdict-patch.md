Confirmed: `shrink.ts:425` resolves the shrink agent via `resolveSubRoleAgentOrder(cfg, "reviewActuator")`, while `config.md:285-286` documents shrink under `patchActuator`. The doc contradicts the code and the spec.

## Verdict — Refinement Required

### Required outcome

**Correct `v1/docs/config.md`'s `subRoleAgentOrder` key attributions to match the wiring.** The operator-facing key reference currently lists:
- `reviewActuator`: verdict actuator
- `patchActuator`: implementation loop **and shrink agent**

This is wrong in both directions. The shrink agent resolves its order from `reviewActuator` (not `patchActuator`), and `patchActuator` governs only the implementation loop. After the fix, the reference must convey that `reviewActuator` governs both the verdict actuator (head-only) and the shrink agent (full list), and `patchActuator` governs the implementation loop alone.

**Why this blocks:** `config.md` is the operator's reference for *which key to set*, and it is the lone doc inconsistent with the code — `agents.md` and `v2/docs/v1-behaviors.md` both correctly attribute shrink to `reviewActuator`. The error directly contradicts the spec's central, repeatedly-pinned decision (`00` AC #5 and `01`'s decisions/ACs: "the single `reviewActuator` key governs both the verdict actuator (head-only) and the shrink agent (full list)"). An operator following the current doc would set `patchActuator` intending to tier shrink, silently get no effect on shrink, and unexpectedly retune the patch loop instead — a costly, silent misconfiguration that defeats the feature's purpose.

### Findings not requiring action

- **Capability-floor coupling not validated against override orders** (floor set + override list missing `capability` passes config load, then gets stripped at runtime → empty active agents). This is a genuine latent failure mode, but it sits at the capability-floor seam the intent **explicitly declares out of scope** ("The actuator capability floor (separate intent)"). The implementation faithfully wired override resolution into the slots `modes.patch.agentOrder` previously occupied; the floor's coupling validator predates overrides. Belongs in a follow-up against the floor work, not this spec.
- **Floor applies to shrink (full-list filter) but not the verdict actuator (head-only) under one `reviewActuator` key.** This is the direct, correct consequence of the spec's load-bearing decision that each consumer "keeps its current consumption mode." Forcing symmetry is the alternative the spec explicitly ruled out. Working as designed; no action.