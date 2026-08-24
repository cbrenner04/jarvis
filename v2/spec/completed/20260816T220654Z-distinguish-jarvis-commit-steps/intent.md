---
name: distinguish-jarvis-commit-steps
---

# Distinguish Jarvis Commit Steps

## Prerequisites

## Surface

Execution loop. The seed touches exactly one canonical module-boundary surface, so splitting does not apply.

## Problem

Jarvis-authored write, review, mutation-repair, and ready-gate commits reuse one subject, and PR attribution cannot summarize their workflow purposes.

## Behavior

- Keep the bare creation title for write/completion commits and add `Jarvis-Step: write`.
- Prefix review commits with `review(<n>):` or `review-debate(<n>):` and add matching `Jarvis-Step: review <n>` or `Jarvis-Step: review-debate <n>` trailers.
- Prefix mutation-repair and ready-gate commits with `mutation-repair:` or `ready-gate:` and add matching `Jarvis-Step: mutation-repair` or `Jarvis-Step: ready-gate` trailers.
- Retain `Jarvis-Ready-Gate: autofix` on ready-gate autofix commits.
- Apply review labeling to intent and plan workflows only when their review passes commit changes; keep their write commit subjects unchanged.
- Keep PR attribution grouped by agent. Within each agent's group, count only that agent's commits carrying a recognized `Jarvis-Step` trailer; show counts only when those commits span more than one normalized step kind.
- Render per-agent counts beside that agent's existing summary as `Steps: write <n>, review <n>, review-debate <n>, mutation-repair <n>, ready-gate <n>`, omitting zero counts and using that workflow order. Normalize `review <pass>` and `review-debate <pass>` to `review` and `review-debate` for counting.

## Decisions

- Workflow-context callers supply step kind and review pass number to the committer; rules out inferring workflow purpose from Git state.
- The committer accepts optional step metadata and defaults absent metadata to `write`; rules out breaking existing callers and stored pending-commit files.
- Subjects remain human-readable while `Jarvis-Step` is the classification contract; rules out subject parsing by attribution consumers.
- Step counts are per agent, ignore commits without a recognized `Jarvis-Step`, and use fixed workflow ordering; rules out PR-wide aggregation, legacy-commit inference, and unstable footer output.
- Attribution otherwise retains its current commit bullets and agent summary; rules out a broader footer redesign.

## Acceptance criteria

- [ ] A light review mutation commit uses subject `review(1): <title>` and carries `Jarvis-Step: review 1` beside `Jarvis-Agent`, pinned by a workflow-runner test that fails against the pre-fix identical subject.
- [ ] Debate review, mutation-repair, and ready-gate autofix commits use their specified subject prefixes and matching `Jarvis-Step` trailers, while ready-gate autofix retains `Jarvis-Ready-Gate: autofix`; pinned by tests that fail against the pre-fix messages.
- [ ] A write/completion commit message is unchanged apart from `Jarvis-Step: write`, and a stored pending commit without step metadata commits as `write`; pinned by completion-commit tests.
- [ ] Each agent's attribution group renders its own ordered `Steps:` counts only when that group's trailer-bearing commits span multiple normalized kinds, excluding untrailed commits and normalizing review pass numbers; pinned by a footer test that fails against the pre-fix footer.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v1/docs/worktrees-and-commits.md` — `Jarvis-Step` trailer values and conditional per-step footer counts.
- `v2/docs/write-behavior.md` — step-aware completion commit message contract.
- `v2/docs/v1-behaviors.md` — widened Jarvis-authored commit trailer set.
