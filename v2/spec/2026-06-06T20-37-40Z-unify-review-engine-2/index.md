# Unify review engine (plan + patch)

- [ ] [00 - Plan review reads `modes.review`](./00-plan-review-uses-modes-review.md)
- [ ] [01 - Shared review-prompt fragment](./01-shared-review-prompt-fragment.md)
- [ ] [02 - Shared review write-boundary detection](./02-shared-review-write-boundary.md)

## Re-verification of seams (against landed #178)

#178 has fully merged; the seams differ from the intent's assumptions. Verified in-tree:

- `modes.review.{passes,agentOrder}`, `resolveReviewPasses(cfg, override)`, and `resolveReviewAgentOrder(cfg)` (= `modes.review.agentOrder ?? modes.plan.agentOrder`) already exist (`v1/src/config.ts`). The "passes resolver" and "agent-order resolver" seams are already built — no new helpers needed. Plan just doesn't call them yet (`v1/src/modes/plan/review.ts:214` hardcodes `modes.plan.agentOrder`; `v1/src/commands/plan.ts` hardcodes `?? 2`). → subspec 00.
- `prompts/patch/review.md` exists; the shared subtractive-bias wording is duplicated across it and `prompts/plan/review.md`. `prompts/shared/pr-description.md` is the precedent for a shared fragment. → subspec 01.
- Plan's review write-boundary (`validateReviewOutput`/`isValidIntentModification`, intent.md immutable + blocker-append allowed, reaction = error) and patch's (`detectSpecTreeEdits`/`revertSpecTreeEdits`, spec/** frozen, reaction = revert) duplicate the porcelain-walk + path-filter detection. Shared *detection*, mode-specific *reaction*. → subspec 02.

## Deferred — not forced into one engine

The intent's "lift `runReviewPass` into a common module both modes call" does not fit the landed code without a behavior change the intent forbids:

- Agent strategy diverges: plan's `runReviewPass` tries every agent in order within one pass; patch's `runReviewPhase` uses `agents[0]` and shifts on quota across passes. Collapsing forces one strategy onto the other mode.
- Prompt inputs diverge: plan injects intent + guidance + spec snapshot and the agent rewrites spec files; patch injects spec tree + branch diff and the agent refactors code. `buildReviewPrompt`/`snapshotSpecFiles` are plan-shaped; patch's are different-shaped.
- Per-pass commit + telemetry diverge: plan commits `plan: review N` (+ resume `rK`, plus a `commit:false` path) via `plan-telemetry`; patch commits `review: pass N` via patch telemetry. Different subjects, resume-suffix, and telemetry subsystems.

Deferred to first clean fit: a single pass-loop / commit-path / telemetry shape — pin when one mode's agent strategy or commit semantics is deliberately changed to match the other.

## Out of scope

- Any review behavior change beyond plan review's agent + passes source (subspec 00).
- v2 model/agent rework; engine stays in v1, not `shared/**` (no v2 review consumer; `shared/**` can't import `v1/**`).
