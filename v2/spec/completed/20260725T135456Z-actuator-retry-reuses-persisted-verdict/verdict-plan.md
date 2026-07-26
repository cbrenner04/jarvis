## Verdict: required refinements

### Intent and operator recovery wording

- **`intent.md` must match the subspec operator path.** Recovery is re-dispatching the same workflow with actuator-only replay, not a separate CLI or “retry without re-dispatch.” Fix the documentation bullets and the first decision line so it does not read as forbidding re-dispatch; it should forbid re-dispatch that replays write, shrink, and debate.

### Eligibility contract (precise persistence fields)

- **Decisions must name the real failure surface**, not a top-level `failedRole` on the review run row. Eligibility is actuator failure with post-commit retryable `failureKind` (`timeout` / `stall`) on the persisted last-attempt failure detail (role + kind together). This avoids implementers wiring the wrong field.

### Test contract strength

- **Primary acceptance must pin the full skip contract**, not only “zero implement invocations + one actuator.” Second pass must assert: no implement write agent, no shrink, no adversary/advocate/adjudicator, exactly one actuator using unchanged `verdictPath` content; must fail pre-fix.
- **Clarify relationship to existing redispatch tests:** strengthen or replace weak cases so preservation criteria do not lock in debate/shrink replay as acceptable.
- **First pass must exercise shrink** (fixture where shrink runs on the initial successful implement completion) so “no shrink on retry” is meaningful; minimal implement steps that never shrink are insufficient.
- **Add a negative eligibility case:** re-dispatch after a debate-role (non-actuator) timeout/stall on the same step must not take actuator-only admission (debate/shrink behavior unchanged vs today).
- **Missing/empty `verdictPath`:** keep named-path failure; pre-fix failing-test wording applies to the primary timeout path; stall can share the same guard if decisions state that explicitly.

### Review run / attempt semantics

- **Decisions must state what happens to the durable review run on actuator-only re-dispatch** (new attempt on same run vs new run row), aligned with how existing re-dispatch tests model store reuse. Operator listing/telemetry depends on this; leaving it implicit is a spec gap.

### Actuator prompt parity

- **One decision:** actuator-only retry uses the same actuator prompt path as the first attempt (including `profile.render.actuator` when configured), not raw verdict bypass.

### Documentation outcomes

- **`operator-runbook.md` updates must reconcile conflicting recovery text:** paragraphs that imply ~30 minutes of full write/shrink/debate replay and generic checkpoint reuse must distinguish actuator timeout/stall with verdict on disk (actuator-only) from debate-role failures and other recovery paths.
- **`workflow-runner.md` and `v1-behaviors.md` bullets remain as drafted;** runbook reconciliation is the extra doc requirement above.

### Scope and edge cases (decisions, not necessarily new ACs)

- **Clarify or explicitly defer:** multi-cycle implement review (`maxCycles` / multiple passes) and `freshDispatch` (or equivalent) if operators can hit this recovery path—admission should be “last cycle failed at actuator with persisted verdict” or scope limited to single-cycle presets.
- **Optional but recommended:** short **Prerequisites** in the subspec (verdict before actuator; actuator failures distinguishable from debate failures), mirroring `intent.md`, since plan-time gates belong in the implementable artifact.
- **Doc note (no AC required):** last-rung / exhausted-rung timeout guidance may still apply for non-actuator failures; actuator-only retry changes operator expectations only where verdict exists.

### Rationale (compressed)

Intent promises waste-free actuator retry and no silent full re-run; the subspec’s core decisions and guard-inversion AC align with that. Gaps are contract precision (persistence fields, run-row policy), tests that would pass today while still replaying debate/shrink, missing negative eligibility, intent/runbook contradictions on *how* to retry, and runbook text that would mislead after the change. Spec guidance demands failing tests for new behavior, guard inversion, behavior-change cataloging in `v1-behaviors.md`, and agent-verifiable ACs—the refinements above close those holes without changing the feature direction.

### Not required in this pass

- Settlement/`error.reason`/`resumable` telemetry ACs (out of core intent).
- Enumerating every `verdictPath` I/O error variant beyond named-path preflight failure.
- Expanding scope to non–`review-debate` critic/actuator steps (subspec deferral stands).