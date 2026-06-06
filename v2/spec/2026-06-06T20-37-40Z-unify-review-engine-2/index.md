# Unify review engine (plan + patch)

- [ ] [00 - Plan review reads `modes.review`](./00-plan-review-uses-modes-review.md)

## Seams re-verified against landed #178

#178 merged, so the intent's "depends on #178, not yet landed" premise is stale. Two seams the intent listed as work already exist: `resolveReviewPasses(cfg, override)` and `resolveReviewAgentOrder(cfg)` (= `modes.review.agentOrder ?? modes.plan.agentOrder`) in `v1/src/config.ts`. Plan just doesn't call them — that gap is subspec 00, the intent's headline behavior change and the only real, behavior-improving work in the tree.

The intent's other DRY seams do not survive contact with the landed code; each would force divergent code into a shared shape, adding indirection (or behavior change the intent forbids) rather than removing duplication. Deferred:

- **`runReviewPass` engine.** Three axes diverge: agent strategy (plan tries every agent per pass; patch `runReviewPhase` uses `agents[0]`, shifts on quota across passes); prompt inputs (plan injects intent+guidance+spec-snapshot and rewrites spec files; patch injects spec-tree+branch-diff and refactors code); commit+telemetry (`plan: review N` +resume `rK` via plan-telemetry vs `review: pass N` via patch telemetry).
- **Shared prompt fragment.** `prompts/plan/review.md` is a spec-*rewriting* prompt; `prompts/patch/review.md` is a code-*refactoring* prompt. Verbatim overlap is ~2 lines; "no-commit"/"no-tests" carry mode-specific qualifiers and "no-checklist-edits" is patch-only. A registered fragment + revision bumps + golden tests exceeds the duplication it removes.
- **Parameterized write-boundary validator.** Not parallel copies. Plan's `validateReviewOutput` does a content before/after comparison of one file (`intent.md`) with blocker-append + frontmatter-immutability discrimination; it never walks porcelain for paths. Only patch's `detectSpecTreeEdits` walks `git status --porcelain` and filters by subtree prefix. A single detector would *add* porcelain logic to plan — new code, and behavior-change risk the intent forbids — not share existing logic.

Deferred to first clean fit: pin if/when one mode's agent, commit, prompt, or boundary mechanism is deliberately changed to match the other.

## Out of scope

- Any review behavior change beyond plan review's agent + passes source (subspec 00).
- v2 model/agent rework; engine stays in v1, not `shared/**` (no v2 review consumer; `shared/**` can't import `v1/**`).
