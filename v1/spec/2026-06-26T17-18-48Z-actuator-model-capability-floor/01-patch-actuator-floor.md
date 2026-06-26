# Floor-aware patch actuator selection

Enforce the capability floor for the patch iteration actuator at initial
selection and across the quota/error fallback ladder. The patch review-actuator
inherits this for free: it reuses the iteration's active agent ladder
(`completion-pipeline.ts` passes `ctx.activeAgents` as `actuatorAgents`), so
filtering the ladder once also governs the review-actuator.

## Decisions

- Introduce one pure helper that filters an actuation `agentOrder` to entries with `capability >= floor`, order preserved; floor absent ⇒ identity. Shared so subspec 02 reuses it. Rules out duplicating the comparison at each call site.
- Floor filtering precedes the patch-tier start-index slice in `buildActiveAgents`; the tier index is resolved against the floor-eligible ladder. Rules out slicing first then filtering, which would let the tier index point past the eligible set or skip eligible agents.
- Floor `capability` and tier position are independent selectors that compose by sequence, not by reconciliation: the floor filter removes below-floor entries, then the tier start-index selects a position *within the floor-eligible ladder* (position-within-eligible, not max-capability-within-eligible). The two only agree when the operator keeps `capability` monotonic with ladder position (cheapest/least-capable first, as the tier system already assumes). If an operator sets non-monotonic `capability` (a more-capable model earlier than a less-capable one), the floor still correctly drops below-floor entries, but the tier slice may land on a lower-`capability` eligible entry than a later one — the tier picks by position as documented, capability only gates eligibility. Rules out silently reordering the ladder by `capability` (which would break the tier system's positional cost ordering) and rules out making the tier select max-capability.
- Filtering at ladder construction is what makes fallback floor-safe: below-floor entries are absent from the ladder, so the existing `activeAgents.shift()` fallback can never reach one. Rules out a separate per-step floor check during fallback.
- The floor governs configured `agentOrder` entries only; an explicit `--agents` override is a deliberate operator escape hatch and is **not** re-checked against the floor. An override substitutes a model onto an entry that already passed (or bypassed) the filter, so it can place a below-floor model on an eligible slot by operator intent. Rules out silently overriding the operator's explicit `--agents` choice, and rules out leaving the documented bypass unstated.
- Zero floor-eligible actuators is a fatal preflight error (exit 1) naming the role (`patch actuation`) and the floor, emitted on stderr with the run's telemetry, surfaced before any agent runs. Rules out falling through to the historical "no agents available" / drain paths, which would not explain the cause.
- Eligible agents that all drain keep their existing outcomes — quota-exhausted (exit 2) and no-progress (exit 4) — not the floor error. Floor filtering shrinks the ladder, so these drains are reached sooner, but the principle is unchanged: qualifying-agents-exhausted is a runtime outcome, not a config error, which the floor error (config problem) stays distinct from.

## Task checklist

- Add the floor-filter helper (e.g. in `v1/src/config.ts` or a selection module) over `AgentEntry[]`.
- Apply it in `buildActiveAgents` before `resolvePatchTierStartIndex`/slice (`v1/src/modes/patch/preflight.ts`).
- Surface the named floor error + exit 1 when the eligible ladder is empty (preflight/run path).
- Tests: initial selection skips below-floor at/after the tier start index; fallback never lands on below-floor; explicit `--agents` override honored even when below-floor; empty-eligible errors with role+floor; floor-unset path unchanged; review-actuator phase runs only floor-eligible models.
- Update `v2/docs/v1-behaviors.md` with the new selection/fallback behavior.

## Acceptance criteria

- [ ] With a floor set, initial patch actuator selection skips in-order entries whose `capability < floor` and starts on the first floor-eligible agent at or after the tier start index.
- [ ] On quota/error fallback, the patch run never falls back onto an entry whose `capability < floor`; it advances only among floor-eligible agents.
- [ ] An explicit `--agents` override is honored as configured even when it places a below-floor model on an eligible slot (the floor governs configured entries, not the override).
- [ ] When no `modes.patch.agentOrder` entry meets the floor, the run exits non-zero before invoking any agent with an error naming the actuation role and the floor.
- [ ] When floor-eligible agents exist but all drain, the run still ends in its existing drain outcome (quota-exhausted or no-progress), not the floor error.
- [ ] The patch review-actuator phase selects only floor-eligible models (it reuses the floor-filtered active ladder).
- [ ] With no `actuationCapabilityFloor` configured, patch selection and fallback behavior is unchanged.
- [ ] `v2/docs/v1-behaviors.md` records the floor-aware patch selection/fallback behavior.

## Documentation updates

- `v2/docs/v1-behaviors.md`: floor-aware patch actuator selection + fallback + empty-eligible error.
- `v1/docs/run-loop.md`: note the floor skip in the iteration/fallback selection description.
