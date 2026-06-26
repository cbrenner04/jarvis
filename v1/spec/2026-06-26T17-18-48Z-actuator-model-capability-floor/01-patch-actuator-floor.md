# Floor-aware patch actuator selection

Enforce the capability floor for the patch iteration actuator at initial
selection and across the quota/error fallback ladder. The patch review-actuator
inherits this for free: it reuses the iteration's active agent ladder
(`completion-pipeline.ts` passes `ctx.activeAgents` as `actuatorAgents`), so
filtering the ladder once also governs the review-actuator.

## Decisions

- Introduce one pure helper that filters an actuation `agentOrder` to entries with `capability >= floor`, order preserved; floor absent ⇒ identity. Shared so subspec 02 reuses it. Rules out duplicating the comparison at each call site.
- Floor filtering precedes the patch-tier start-index slice in `buildActiveAgents`; the tier index is resolved against the floor-eligible ladder. Rules out slicing first then filtering, which would let the tier index point past the eligible set or skip eligible agents.
- Filtering at ladder construction is what makes fallback floor-safe: below-floor entries are absent from the ladder, so the existing `activeAgents.shift()` fallback can never reach one. Rules out a separate per-step floor check during fallback.
- Zero floor-eligible actuators is a fatal preflight error (exit 1) naming the role (`patch actuation`) and the floor, surfaced before any agent runs. Rules out falling through to the historical "no agents available" / quota-exhausted paths, which would not explain the cause.
- Eligible agents that all hit quota stay the existing quota-exhausted exit (2), not the floor error. Distinguishes "no agent meets the floor" (config problem) from "qualifying agents exhausted" (runtime).

## Task checklist

- Add the floor-filter helper (e.g. in `v1/src/config.ts` or a selection module) over `AgentEntry[]`.
- Apply it in `buildActiveAgents` before `resolvePatchTierStartIndex`/slice (`v1/src/modes/patch/preflight.ts`).
- Surface the named floor error + exit 1 when the eligible ladder is empty (preflight/run path).
- Tests: initial selection skips below-floor; fallback never lands on below-floor; empty-eligible errors with role+floor; floor-unset path unchanged; review-actuator phase runs only floor-eligible models.
- Update `v2/docs/v1-behaviors.md` with the new selection/fallback behavior.

## Acceptance criteria

- [ ] With a floor set, initial patch actuator selection skips in-order entries whose `capability < floor` and starts on the first floor-eligible agent.
- [ ] On quota/error fallback, the patch run never falls back onto an entry whose `capability < floor`; it advances only among floor-eligible agents.
- [ ] When no `modes.patch.agentOrder` entry meets the floor, the run exits non-zero before invoking any agent with an error naming the actuation role and the floor.
- [ ] When floor-eligible agents exist but all exhaust quota, the run still ends in the existing quota-exhausted outcome, not the floor error.
- [ ] The patch review-actuator phase selects only floor-eligible models (it reuses the floor-filtered active ladder).
- [ ] With no `actuationCapabilityFloor` configured, patch selection and fallback behavior is unchanged.
- [ ] `v2/docs/v1-behaviors.md` records the floor-aware patch selection/fallback behavior.

## Documentation updates

- `v2/docs/v1-behaviors.md`: floor-aware patch actuator selection + fallback + empty-eligible error.
- `v1/docs/run-loop.md`: note the floor skip in the iteration/fallback description if selection is documented there.
