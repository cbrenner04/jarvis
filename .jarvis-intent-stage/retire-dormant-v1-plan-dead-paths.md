---
name: retire-dormant-v1-plan-dead-paths
---

# Retire dormant v1 plan name-only and unreachable critic paths

## Problem

`prompts/plan/name-only.md` is off-registry and loaded only by `v1/src/modes/plan/name-only.ts`, whose sole entry point `runNameOnlyPhase` has zero importers. v1 plan-review's critic arm (`v1/src/modes/plan/review.ts`) is unreachable because `v1/src/modes/review/run.ts` admits only adversary, advocate, and adjudicator roles.

## Decision ledger

- Delete `runNameOnlyPhase`, `v1/src/modes/plan/name-only.ts`, and `prompts/plan/name-only.md` together; rules out keeping an unreachable v1 entry point for symmetry.
- Remove the unreachable critic branch and align v1 plan-review role handling with the actual debate role type; rules out dead role plumbing surviving the sweep.

## Acceptance criteria

- [ ] `runNameOnlyPhase`, `v1/src/modes/plan/name-only.ts`, and `prompts/plan/name-only.md` are absent; grep finds no `runNameOnlyPhase` outside git history.
- [ ] `v1/src/modes/plan/review.ts` no longer selects `plan.prompt.review.critic` for a `critic` role; a regression test fails against the pre-fix unreachable branch.
- [ ] `bun run typecheck` and `bun run test:v1` pass.

## Documentation updates

- `v1/docs/agent-cli-failure-pipeline.md` — drop the dormant `name-only` export note.
- `v1/docs/agents.md` — remove stale `name-only` phase references from the live plan-mode path description.

## Prerequisites
