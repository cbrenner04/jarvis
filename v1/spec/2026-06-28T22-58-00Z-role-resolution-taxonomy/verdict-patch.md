# Adjudicator verdict — role-resolution-taxonomy

The slice satisfies its acceptance criteria: canonical `role-resolution.md`, category retirement in the three named durable docs, shrink pinned to `implement`, v1 tier mapping with consumption footnote, and explicit deferrals. Three documentation defects remain that would mislead Phase 5 and agent-model-config consumers if left unfixed.

## Required outcomes

1. **`plan` purpose must not describe verdict application.** In `v2/docs/role-resolution.md`, the `plan` row currently says it drafts, refines, and applies verdicts to the spec tree. Verdict application is exclusively the `actuator` role under `review-and-update`; plan-mode spec refinement runs through debate roles, not `plan`. The one-line purpose must describe write-loop spec/plan authoring only, with no verdict-application or ambiguous “refine” wording that overlaps review-debate semantics.

2. **Ledger must record `implement` expressiveness limits against divergent v1 tiers.** v1 binds implementation loop (`patchActuator`) and post-completion shrink (`reviewActuator`, full-list) to different configurable tiers; v2 maps both to `implement`, yielding one `(agent, implement) → model` binding per agent. When those v1 tiers differ, v2 cannot represent both independently without disambiguation beyond bare `(agent, role)`. The decisions ledger in `role-resolution.md` must state this explicitly so agent-model-config and Phase 5 do not assume full v1 tier parity through a single `implement` key.

3. **Tuple ordering must be consistent as `(agent, role)` everywhere.** `v2/docs/v2-architecture.md` uses `(role, agent)` in the “Exactly one model per …” bullet while the rest of the taxonomy contract uses `(agent, role) → model`. All resolution-key tuple references in the updated durable docs must use the same `(agent, role)` ordering.

## Rationale

Outcome 1 fixes an internal contradiction in the canonical taxonomy home — the doc that downstream slices treat as normative. A consumer binding plan-mode verdict steps to `plan` would violate the closed union and the architecture review-as-debate contract.

Outcome 2 closes a load-bearing gap the slice deliberately introduced: shrink → `implement` is correct taxonomy, but the cost of collapsing two independently configurable v1 tiers under one role is not yet recorded where implementers look first. Without the ledger entry, agent-model-config may silently assume round-trip parity.

Outcome 3 is a contract-consistency fix with zero semantic ambiguity today but real confusion risk once schema work begins.

## Not required in this pass

Shrink propagation into architecture/vision workflow sketches, meta-index and build-order stale category prose, plan-mode v1 mapping parity, reference-table consumption hints, shrink-section cross-links, and `operator` validation deferrals are real hygiene or follow-on items but outside this slice’s written acceptance criteria or explicit deferrals. No action required before merge beyond the three outcomes above.
