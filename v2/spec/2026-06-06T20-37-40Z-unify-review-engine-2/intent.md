---
name: unify-review-engine-2
---
# Intent: one review engine for plan and patch, driven off `modes.review`

Patch review (PR #178, `patch-review-loop`) lands a second review loop that
mostly clones plan mode's existing one (`v1/src/modes/plan/review.ts`, ~430
lines). This intent collapses the two onto a single review engine — a common v1
module shared by both modes — and points plan review at the new `modes.review`
model tier. **Depends on #178** —
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
  `snapshotSpecFiles` out of `modes/plan/` into a common v1 module both modes
  call; patch review consumes it instead of a parallel copy.
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

## Location — stays in v1

The engine lives in a v1 module (e.g. `v1/src/modes/review/`), consumed by both
v1 review loops. **It does not move to `shared/**`.** Two reasons:

- `shared/**` is for code consumed by *both v1 and v2*. There is no v2 review
  consumer — v2 review doesn't exist, and this work explicitly stays in v1.
  Putting it in shared builds the abstraction ahead of its second consumer;
  structure should grow behind consumers, not in front of them.
- `shared/**` must not import `v1/**`, so the mode-specific bits (blocker
  posting, PR helpers, commit/trailer path) would all have to be injected in —
  real indirection cost for an abstraction with one caller. Keep it in v1; if
  v2 ever grows a review loop, promote it then with two real consumers in hand.

## Out of scope

- Changing what either review loop *does* (no behavior change beyond plan
  review's agent source moving to `modes.review`).
- The v2 model/agent rework ([[separate-models-from-agents]]); this stays in v1.
- Patch review's own loop semantics (owned by #178).

## Behavior delta + docs

Plan review's agent source moves from `modes.plan.agentOrder` to
`modes.review.agentOrder ?? modes.plan.agentOrder`. That is a change to existing
v1 behavior, so drafting must update `v2/docs/v1-behaviors.md` to match.

## Open questions for drafting

- Whether plan and patch keep separate `passes` defaults or both read
  `modes.review.passes`.
- Sequencing: #178 is still in flight. The seams here assume its final shape
  (`modes.review.{agentOrder,passes}`, `prompts/patch/review.md`, the
  agent-order resolver). Land after #178 merges, and re-verify the seams against
  what actually landed before drafting. Also sequence vs #176 (PR-body
  ownership).

## Refine skip

Load-bearing decisions are already captured in the seed: engine stays in v1
(with both ruling-out reasons), parameterized write-boundary validator,
agent-order resolver plus the behavior delta and its `v1-behaviors.md`
obligation. Verified against the repo that #178 has not landed
(`modes/patch/review.ts`, `modes/review/`, `prompts/patch/review.md`, and
`modes.review` config are all absent) — which is exactly why seam
re-verification and sequencing are already listed as open questions. The
`passes`-default and #178/#176 sequencing choices belong to the drafter once
#178's final shape exists; pinning them now would invent precision. Nothing
load-bearing is missing.

## Blocker

Review and approve `v2/spec/2026-06-06T20-37-40Z-unify-review-engine-2/intent.md` before drafting subspecs.

Optional feedback:
- Add missing constraints, assumptions, and risks directly in `intent.md`.
- If scope is unclear, append focused questions to this blocker section.

Resume drafting once approved:
`jarvis1 plan --resume-draft v2/spec/2026-06-06T20-37-40Z-unify-review-engine-2/intent.md`
