## Verdict — Refinement Required

The design's architecture and scope are sound (additive optional schema, `validateAgentOrder` reuse, correct per-sub-role fallbacks, tiering composition, properly-walled scope). The spec is underspecified at the two seams where the three sub-roles' consumers diverge from its "one order, routed uniformly" mental model. The following refinements are required before run.

### 1. `01` — Verdict actuator and shrink consume `reviewActuator` differently (must fix)
The spec collapses the verdict actuator and shrink agent into "use the `reviewActuator` order," but they consume an order in two structurally different ways today: shrink iterates the full list for quota fallback, while the verdict actuator reads only the head's model (`review.ts` reads `agentOrder[0]?.model`). "Use that order" is therefore two operations, not one.
- Add a decision pinning: verdict actuator reads `reviewActuator[0]` (head, no quota fallback gained); shrink maps the full `reviewActuator` list — each preserving its current consumption mode.
- Split the single AC into two verifiable lines, one per consumer.

### 2. `01` — `reviewPanel` routing requires new plumbing (must fix; highest implementation risk)
All three review entry points (patch-run review, standalone `jarvis review`, plan self-review) share one resolver call site with no caller discriminator. The decision asserts standalone/plan-self-review stay "untouched" while patch review uses `reviewPanel`, but nothing at that site currently knows which caller it serves — the mechanism is unspecified, and an implementer could reasonably choose param vs. flag vs. resolver branching (an observable, costly-to-reverse choice).
- Add a decision naming the mechanism: thread the resolved order (or sub-role/context) from the patch-run caller into the review entry, leaving the default path resolving via the existing review resolver unchanged.

### 3. `00` — Tighten the Problem statement (must fix)
The Problem says review actuator and patch actuator "both resolve from `modes.patch.agentOrder`" without noting the verdict actuator consumes only the head, not the sliced list. This imprecision is what masks issue #1. State the head-vs-list distinction.

### 4. `00` — Acknowledge the strict-child/lenient-parent divergence (must fix)
Hard-failing unknown `subRoleAgentOrder` keys is the correct default (a typo'd sub-role silently drops a tier the operator believes is active), but `modes.patch` itself tolerates unknown keys. Add a clause to the unknown-key decision stating the strictness intentionally diverges from the lenient parent, and why.

### 5. `00` — Pin the type location (must fix)
Resolve "`ModeConfig` (or a patch-only type)" now — pin it to `ModeConfig` (consistent with the existing patch-only `shrink` field already living there). Leaving it open hands a structural decision to the implementer.

### 6. ACs — Close quota-fallback and citation gaps (must fix)
- Add an explicit AC: an override preserves quota-fallback iteration for shrink and the patch loop, while the verdict actuator remains head-only.
- Replace "existing review-mode tests stay green" with citations to the specific pinning tests for standalone `jarvis review` and plan self-review. Per spec-guidance's refactor-AC rule ("cite the test, don't paraphrase"), the "unchanged" claim now depends on a parameter defaulting correctly and must name the tests that prove it.

### 7. Docs — Make `reviewActuator` coverage explicit (minor)
The `v1/docs/agents.md` update must state that the single `reviewActuator` key governs both the verdict actuator and the shrink agent, which consume the order differently.

### Rationale
Refinements 1–2 are genuine design gaps, not nitpicks: both sit at consumer seams where the spec's uniform-routing framing hides real structural divergence, and an implementer would otherwise have to invent the missing decisions. 3–7 are precision and explicit-decision additions that the quality ledger principle (each load-bearing decision names the wrong alternative it rules out) and the refactor-AC citation rule already require. None alters the spec's architecture or scope.