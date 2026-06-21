---
name: plan-pr-auto-ready
---

# plan-pr-auto-ready — SATISFIED (residual: intent PRs)

## Resolved (2026-06-21)

A plan run **blocked** on this seed: the behavior is **already implemented**.
`safeMarkPlanPrReady` (`v1/src/modes/plan/run.ts:1261`, `:1395`) flips a plan PR to ready on the
commit:true success path, and `v1/docs/plan-mode.md` documents it. Confirmed live this session —
every `gh pr ready` on a *plan* PR (#334/#338/#346) returned "already ready." Good Blocker catch
(refused to draft a no-op; $1.08, ~2 min).

## Residual gap (low priority): intent PRs don't auto-ready

The real observed pain was **intent** PRs (#333/#337) coming up as drafts and needing manual
`gh pr ready` — `v1/src/commands/intent.ts` has no equivalent of `safeMarkPlanPrReady`. Mirroring
that flip into the intent draft-PR path would close it. Deprioritized because the overlord now
**hand-promotes** single-behavior seeds (copy wip→ready + `## Prerequisites`), bypassing intent
mode entirely — so this rarely bites. Revisit if intent mode returns to regular use. See
[[intent-split-emit-contract-flaky]] (the other intent-mode reliability gap).
