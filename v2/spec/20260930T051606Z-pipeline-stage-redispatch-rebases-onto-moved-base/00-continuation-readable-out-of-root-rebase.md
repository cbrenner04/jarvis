# 00 — Continuation-readable spec and out-of-root rebase

## Problem

`evaluateCommittedLaneContinuation` (`v2/src/commands/cleanup.ts`) refuses a non-descendant clean lane when `trackableSpecPath === undefined`. `resetStaleWorkspace` sets `trackableSpecPath` only when `isStaleResetLandedCriteriaSpecPath` is true (spec inside `projectRoot`). Chained implement stage specs live in a prior worktree under `~/.jarvis/worktrees/...`, so pipeline re-dispatch refuses `worktree HEAD … is not a descendant of base main …; stale reuse refused` as soon as base moves while in-root standalone lanes rebase and continue.

## Decisions

- Split **continuation spec readability** from **in-root landed-criteria spec path**: moved-base rebase (no open PR) keys on a continuation-readable write-step spec path; landed-criteria drift and in-root tick-backing keep `isStaleResetLandedCriteriaSpecPath` / `trackableSpecPath` only — rules out widening gate 2 to out-of-root trees or reusing the landed-criteria gate as the rebase gate.
- Continuation-readable evaluation honors the same `externalPlanSpec` boundary as `buildResetStaleWorkspaceOptions` (`stale-reset-workspace.ts`: paths withheld from `resetStaleWorkspace` are not continuation-eligible) — rules out helpers or tests that treat raw write-step paths outside that contract as rebase-eligible.
- Out-of-root chained lanes skip `evaluateContinuationTickBacking` (same as today when `trackableSpecPath` is undefined); only continuation-readable gating enables rebase — rules out absolute-path tick-backing that lane `git log` cannot validate against prior-worktree spec paths.
- No open draft PR on the lane: rebase onto resolved base via existing `rebaseWorktreeOntoBase`; return `preRebaseSha` on `continue` — rules out leaving out-of-root moved-base lanes stuck until hand-merge.
- Rebase conflicts abort with tree and branch unchanged; refusal uses existing rebase-conflict wording — rules out partial application on conflict.
- No shared history (`hasCommonAncestor` false) or a dirty tree still refuse unchanged — rules out weakening those gates for chained stages.
- Continuation-readable predicate: the write-step spec path (in-root or out-of-root) is readable when, existence-checked at the path the write step reads, it is an existing Markdown file or a directory containing `index.md` — rules out treating a missing path or an `index.md`-less directory as rebase-eligible.
- Intent AC “conflicting base change” for the no-PR path is satisfied by the preserved `resetStaleWorkspace aborts a conflicting rebase…` test; open-PR merge conflicts are owned by [01](01-merge-when-open-pr-moved-base.md).

## Tasks

- [ ] Add a continuation-readable spec helper (distinct from `isStaleResetLandedCriteriaSpecPath`); implement the pinned predicate from Decisions; thread into `evaluateCommittedLaneContinuation` while keeping `trackableSpecPath` for landed-criteria and in-root tick-backing only.
- [ ] When continuation-readable but not in-root landed-criteria, run moved-base rebase only (no `evaluateContinuationTickBacking`); leave open-PR moved-base rewrite to [01](01-merge-when-open-pr-moved-base.md).
- [ ] Extend `cleanup.test.ts` temp-git fixtures for chained out-of-root spec shape (prior-worktree spec dir + implement lane worktree under managed path).
- [ ] Update `v2/docs/operator-runbook.md` § Incomplete re-run preflight gates — out-of-root continuation rebase (no hand-merge-main workaround for chained stages).
- [ ] Update `v2/docs/v1-behaviors.md` incomplete re-dispatch continuation entry for out-of-root rebase gating (in-root-only wording removal).

## Acceptance criteria

- [x] `cleanup.test.ts` test `resetStaleWorkspace continues a chained out-of-root spec lane past a moved base with no PR` drives `resetStaleWorkspace` with an absolute out-of-root spec path, a clean lane ahead of advanced base, and `ghPrListRunner` returning no PR; asserts `status: "continue"`, rebased tip descended from base, `preRebaseSha` equal to the pre-rebase head, and worktree retained; fails against the pre-fix plain non-descendant refusal (reachable on main: `trackableSpecPath` stays undefined for out-of-root specs).
- [x] `cleanup.test.ts` test `resetStaleWorkspace still refuses a non-descendant out-of-root lane with no common ancestor` uses disjoint histories with a continuation-readable out-of-root spec; asserts `staleResetDescendantGateReason` wording and unchanged tip; regression guard — stays green (pre-fix code already refuses); pins that out-of-root continuation never bypasses the `hasCommonAncestor` refusal.
- [x] `cleanup.test.ts` test `resetStaleWorkspace aborts a conflicting rebase and refuses, leaving the lane unchanged` stays green.
- [x] `cleanup.test.ts` `describe("resetStaleWorkspace: incomplete implement re-run reset")` stays green.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- [ ] `v2/docs/operator-runbook.md` § Incomplete re-run preflight gates — chained out-of-root stage specs and rebase continuation when base moved (no open PR).
- [ ] `v2/docs/v1-behaviors.md` — incomplete re-dispatch continuation: out-of-root rebase gating (not in-root-only).
- [ ] `v2/docs/pipeline-execution.md` — stale-reset/continuation gates paragraph: chained out-of-root continuation via the continuation-readable predicate (rebase when no open PR).
