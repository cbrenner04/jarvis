---
name: published-branch-write-stage-attribution
---

# Published branch credits write-stage authorship

Unsplit rationale: Completion commit stamping, branch publication, and PR attribution footer rendering are one execution-loop completion contract; splitting by file would land coupled halves of the same observable attribution fix.

## Primary implementation surface

- Execution-loop completion commit and PR attribution in `v2/src/execution/`

## Prerequisites

## Problem

- Git-enabled plan and implement workflows publish one commit off base whose tip is CAS-replaced at each terminal boundary, so the surviving `review-debate` commit carries only that stage's `Jarvis-Agent` trailer and erases write-stage authorship.
- The PR attribution footer reads `baseRef..HEAD` trailers, so `Written by <review-agent> through Jarvis.` mis-credits the reviewer whenever it differs from the drafting agent.

## Behavior

- When write and review stages run different agents, the single published commit off base and its attribution footer credit the write-stage (plan/implement drafting) agent, not only the terminal review-debate agent.
- Single-commit-off-base publish shape, `Spec:` header regeneration, narrative marker preservation, `## Commits`, and `## Change summary` rendering stay unchanged.

## Decision ledger

- Keep the single-commit-off-base publish shape and fix trailer/footer attribution on the surviving commit; rules out multi-commit branch history solely for attribution when carried-forward trailers suffice.
- Published attribution must name the write-stage agent when it differs from review; rules out the current review-only footer that erases the drafting author.
- Preserve narrative marker blocks and regenerated header/footer assembly; rules out a footer rewrite that drops preserved narrative content.
- Deferred to first consumer: exact trailer carry-forward shape (all participating stage trailers vs write-primary with review secondary) — pin when plan selects mechanism.

## Acceptance criteria

- [ ] `v2/src/execution/workflow-runner-publication.test.ts` test `credits the write-stage agent in the attribution footer when write and review agents differ` fails against the current review-only footer.
- [ ] `v2/src/execution/completion-commit.test.ts` test `published completion commit carries write-stage Jarvis-Agent when write and review agents differ` fails against pre-fix where only `review-debate` stamps the commit.
- [ ] `v2/src/execution/pr-body-refresh.test.ts` and `v2/src/execution/pr-attribution.test.ts` stay green (narrative markers, `Spec:` header, and step-aware footer counts unchanged).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v1/docs/worktrees-and-commits.md` — write-stage vs review-stage authorship on the single published commit and footer.
- `v2/docs/workflow-runner.md` — PR-body footer credits the write stage, not only review.
- `v2/docs/v1-behaviors.md` — record corrected published-branch attribution when write and review agents differ.
