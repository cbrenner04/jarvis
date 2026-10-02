---
name: detached-pipeline-plan-stage-consumes-ready-intents
---

# Cleanup prunes a ready-intent once its plan spec is on the default branch

## Problem

In a chained pipeline the intent PR adds `ready-intents/<slug>.md` and the plan PR never removes it: the plan branch is cut from the default branch pinned at admission, so the path is absent on its base and no landing can stage a deletion (squash merges also mean no later rebase carries one). After both PRs merge the ready-intent sits on `main` as a live-looking queue item until the spec archives and `provenIntentPrune` (`v2/src/commands/cleanup.ts`, slug lookup shipped #3657) byte-matches it against the archived `intent.md`. Until then it can be re-planned, and any `intent.md` drift strands it forever. Evidence: #3041 (chess `af881ac0`); 2026-10-02 pipeline `b94243a0` (#4438 added `ready-intents/hung-killing-test-counts-as-killed.md`; plan PR #4439 carried no deletion).

**Rejected 2026-10-02:** consuming from the read source (`consumeFrom: "source"` on the intent worktree) only unlinks an uncommitted copy in the intent worktree; `main` is unchanged (pipeline `5da852a8`, plan PR #4448 closed).

## Decisions

- `jarvis cleanup` prunes `ready-intents/<slug>.md` as soon as the default branch holds an open (not yet archived) spec directory for that slug whose `intent.md` is byte-identical, in the same archive branch/PR it already publishes; rules out waiting for archive.
- No byte match → no prune (unchanged safety); dry-run lists the prune as today.
- Fix `v2/docs/first-workflow-walkthrough.md`'s claim that the plan PR removes the queue file.

## Acceptance criteria

- [ ] `cleanup.test.ts`: a ready-intent byte-identical to an open spec dir's `intent.md` on the default branch is pruned on apply and previewed on dry-run; fails against current code (archive-only prune).
- [ ] Same file: a non-identical ready-intent is kept.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/first-workflow-walkthrough.md`, `operator-runbook.md` § Cleanup (stranded archival prune timing).
