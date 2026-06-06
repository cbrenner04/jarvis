# Unify review engine (plan + patch)

- [ ] [00 - Plan review reads `modes.review`](./00-plan-review-uses-modes-review.md)
- [ ] [01 - Shared review-prompt fragment](./01-shared-review-prompt-fragment.md)
- [ ] [02 - Shared review write-boundary detection](./02-shared-review-write-boundary.md)

## Seam status (against landed #178)

#178 has merged, so the intent's "depends on #178, not yet landed" premise is stale. Two seams the intent lists as work are already built: `resolveReviewPasses(cfg, override)` and `resolveReviewAgentOrder(cfg)` (= `modes.review.agentOrder ?? modes.plan.agentOrder`) exist in `v1/src/config.ts` — plan just doesn't call them yet. The remaining real duplication is prompt wording (subspec 01) and write-boundary detection (subspec 02).

## Deferred — not forced into one engine

The intent's "lift `runReviewPass` into a common module both modes call" does not fit the landed code without a behavior change the intent forbids. Three axes diverge:

- Agent strategy: plan tries every agent in order within one pass; patch (`runReviewPhase`) uses `agents[0]` and shifts on quota across passes.
- Prompt inputs: plan injects intent + guidance + spec snapshot and rewrites spec files; patch injects spec tree + branch diff and refactors code. `buildReviewPrompt`/`snapshotSpecFiles` are plan-shaped.
- Commit + telemetry: plan commits `plan: review N` (+ resume `rK`, + a `commit:false` path) via `plan-telemetry`; patch commits `review: pass N` via patch telemetry.

Deferred to first clean fit: a single pass-loop / commit-path / telemetry shape — pin when one mode's agent or commit semantics is deliberately changed to match the other.

## Out of scope

- Any review behavior change beyond plan review's agent + passes source (subspec 00).
- v2 model/agent rework; engine stays in v1, not `shared/**` (no v2 review consumer; `shared/**` can't import `v1/**`).
