## Verdict

1. **Extend the policy deferrals handoff.** `invocation-liveness.md` is the canonical behavioral home; its Deferred section must explicitly record three enforcement-consumer pins so Phase 6 does not reinvent per-phase watchdogs or misread today’s quota-only seam:
   - Profile context plumbing (behavior, role, and step metadata supplied into shared invocation for profile selection).
   - Stall-driven binding advance as a distinct contract extension from quota-only fallback (including how stall recovery is classified vs quota rotation).
   - Stall advance traversal on the flat binding chain (inner + outer rungs), not v1 patch’s outer-only idle escalation.

   **Rationale:** Spec decisions require deferrals at first consumer and forbid per-phase kill semantics invented at enforcement time. These gaps are acknowledged handoff holes, not implementation scope.

2. **Disambiguate read-only debate progress from workspace activity.** The doc must make explicit that read-only debate roles (`adversary`, `advocate`, `adjudicator`) progress via agent output and step-completion markers without repo writes; the workspace-activity signal category applies when the resolved role may write toward the step outcome.

   **Rationale:** Without this, an enforcement reader can treat “review writes” in the workspace row as required for read-only debate or omit workspace signals for actuator verdict apply — contradicting the exemplars and risking mis-profiled enforcement.

3. **Gloss deferred profile-shape placeholders on first use.** `stall budget`, `stall window`, and `profile continuation` must each carry a one-line behavioral definition (bounded no-progress span; illustrative window; no further binding/run continuation permitted by profile) so stall vs slow work definitions are non-circular without pinning numbers or tables.

   **Rationale:** Acceptance criteria require non-circular definitions; those terms currently lean on deferred enforcement detail.

4. **Note metadata-tightened bounds on short-bounded exemplars.** The review-debate `actuator` exemplar must state that step metadata may tighten stall detection and ceiling beyond behavior defaults (e.g. plan vs review-debate actuator context), without duplicating `role-resolution.md` taxonomy.

   **Rationale:** Prevents enforcement from treating all `actuator` invocations as sharing one bounded profile when bounds are metadata-driven.

5. **Record bounded-`implement` profile risk in deferrals or exemplars.** The doc must pin that bounded `implement` contexts (e.g. shrink) must not inherit open-ended `implement` under `write` bounds wholesale — profile tables land at the enforcement consumer.

   **Rationale:** Spec required two exemplar types and deferred tables; without this pin, shrink is a concrete mis-profile risk called out in review.

**No other required outcomes.** Cross-doc updates (`shared-invocation.md` Boundary, `v2-build-order.md` Cross-cutting, `v1-behaviors.md` contrast), guarantees, stall ≠ quota, terminology disambiguation (`isLive`), and `bun run lint:md` meet the acceptance criteria. Optional discoverability polish (back-links, channel liveness note, `shared-invocation.md` opening pointer) is not required for slice completion.
