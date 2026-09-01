---
name: publication-preserves-per-turn-commit-history
---

# Publication preserves per-turn commit history

## Primary implementation surface

Execution loop

## Problem

v2 workflow publication destroys per-turn commit history — a regression from v1. Implement collapses to one CAS-replaced commit off base despite per-iteration `commitSettledIteration` commits. Plan and intent keep multiple commits but stamp every turn with the same boilerplate subject. PR #3234's single-commit-off-base decision and carried-forward trailer attribution are superseded by operator directive (2026-08-31): one distinct commit per turn on the published branch; only the merge to `main` may squash.

## Behavior

- Every workflow (intent, plan, implement) preserves one distinct commit per turn on the published branch: each write/split iteration that produced changes, shrink edits when they change anything, and each review/review-debate pass whose actuator produces edits each become their own commit; passes with no edits add no commit.
- Each commit carries a subject unique to that turn's work, the turn's `Jarvis-Agent`, and that turn's `Jarvis-Step` (`write`, `review n`, `review-debate n`, `shrink`, etc.).
- No terminal boundary (write completion, `~shrink`, review) rewrites, amends, resets, or CAS-replaces prior commits; branch commit count is monotonic non-decreasing across boundaries.
- Publication renders a `## Commits` block (spec-run body summary and PR attribution footer) listing every per-turn commit ahead of base with its agent; the footer no longer credits only the review agent.

## Decision ledger

- Reverse #3234 single-commit-off-base publication; rules out `commit-tree -p pending.baseHead` CAS-replace at terminal boundaries.
- Per-iteration `commitSettledIteration` SHAs survive to the published branch; rules out restaging the full worktree into one replacement commit at publication.
- Plan and intent write turns generate descriptive per-turn commit subjects; rules out repeating the same boilerplate subject across turns.
- Each turn's commit is attributed to that turn's agent and stage; rules out a single carried-forward `Jarvis-Agent` trailer on one surviving commit.
- Multi-pass `review` and `review-debate` yield one commit per mutating pass (`Jarvis-Step` `review n` / `review-debate n`); rules out folding all debate passes into one terminal review commit.
- Terminal boundaries may append new commits but never collapse prior ones; rules out amend, reset, or squash on the publication branch before merge.
- Only the operator's squash-merge to `main` may squash; rules out any harness-side squash or history rewrite.

## Acceptance criteria

- [ ] A `workflow-runner-publication.test.ts` regression drives a multi-subspec implement workflow with single-pass light review to publication and asserts the branch retains one commit per completed subspec write turn plus one mutating review commit (≥ N+1 for N subspecs), each with a distinct subject and correct `Jarvis-Agent`/`Jarvis-Step`; it fails against the current single-commit-off-base collapse.
- [ ] A `workflow-runner-publication.test.ts` regression drives implement publication with multi-pass debate review and asserts each mutating debate pass yields its own `review-debate n` commit ahead of base; it fails when debate passes collapse to one terminal review commit.
- [ ] A `workflow-runner-publication.test.ts` regression drives plan and intent publication and asserts per-turn commit subjects are distinct and describe each turn's work, not a repeated boilerplate line; it fails against the current duplicate-subject behavior.
- [ ] A `workflow-runner-publication.test.ts` regression asserts branch commit count never decreases across write, shrink, and review terminal boundaries; it fails when a boundary CAS-replaces or removes a prior commit.
- [ ] A `workflow-runner-publication.test.ts` regression renders the publication body summary `## Commits` block listing each per-turn commit with its `Jarvis-Agent`; it fails when only the review agent is credited.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass (plus `test:shared`/`test:v1` if shared or v1 surfaces are touched).

## Documentation updates

- `v1/docs/worktrees-and-commits.md` — v2 preserves per-turn commits like v1; retire single-commit-off-base / CAS-replace description.
- `v2/docs/workflow-runner.md` — publication preserves per-turn commit history for intent/plan/implement; only merge to main squashes.
- `v2/docs/v1-behaviors.md` — v2/v1 parity on per-turn commit history; note #3234 single-commit decision superseded.

## Prerequisites
