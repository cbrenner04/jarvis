---
name: unify-review-engine
---
# Intent: one review engine for plan and patch, driven off `modes.review`

Patch review (PR #178, `patch-review-loop`) lands a second review loop that
mostly clones plan mode's existing one (`v1/src/modes/plan/review.ts`, ~430
lines). This intent collapses the two onto a single shared review engine and
points plan review at the new `modes.review` model tier. **Depends on #178** —
it assumes `modes.review.{agentOrder,passes}` and `prompts/patch/review.md`
already exist.

## Why

- After #178 there are two near-identical review loops (plan + patch). Each
  carries its own pass loop, prompt builder, spec snapshot, agent-fallback
  walk, per-pass commit/push/PR-refresh, blocker path, and write-boundary
  check. That duplication will drift.
- `modes.review` is a dedicated critique-model tier. Plan review is critique
  work too, but still runs on `modes.plan.agentOrder` (`plan/review.ts:245`).
  It should use the same review agents as patch review.

## Desired outcome

A single review engine consumed by both modes; plan and patch differ only by a
small set of mode parameters. Plan review resolves its agents from
`modes.review.agentOrder ?? modes.plan.agentOrder` — the same resolver #178
adds for patch.

## Scope — the DRY seams

- **Review-pass engine**: lift `runReviewPass` / `buildReviewPrompt` /
  `snapshotSpecFiles` out of `modes/plan/` into a shared module both modes call;
  patch review consumes it instead of a parallel copy.
- **Write-boundary validator**: one parameterized check `(frozenPaths,
  blockerAppendAllowed)`. Plan = `({intent.md}, true)`; patch = `(spec/**,
  false)`. Replaces `validateReviewOutput` / `isValidIntentModification`.
- **Passes resolver**: one `override → modes.X.passes → 2` helper for both.
- **Agent-order resolver**: one resolver returning the effective review order
  (`modes.review.agentOrder ?? <mode fallback>`), reused by plan and patch.
- **Prompt body**: factor the shared review wording (subtractive bias, scope,
  no-checklist-edits) into one fragment; keep only the mode-specific boundary
  and blocker lines in `prompts/{plan,patch}/review.md`.
- **Per-pass commit + PR-refresh + review telemetry row**: share the
  `review N` / `plan: review N` commit+trailer+refresh path and the
  review-invocation telemetry shape.

## Out of scope

- Changing what either review loop *does* (no behavior change beyond plan
  review's agent source moving to `modes.review`).
- The v2 model/agent rework ([[separate-models-from-agents]]); this stays in v1.
- Patch review's own loop semantics (owned by #178).

## Open questions for drafting

- Where the shared engine lives: `shared/**` (version-agnostic) vs a v1 module.
  `shared/**` must not import `v1/**`, so mode-specific bits (blocker posting,
  PR helpers) inject in.
- Whether plan and patch keep separate `passes` defaults or both read
  `modes.review.passes`.
- Sequencing vs #178 and #176 (PR-body ownership) — land after #178 merges.
