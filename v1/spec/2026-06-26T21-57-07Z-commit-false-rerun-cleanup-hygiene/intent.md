---
name: commit-false-rerun-cleanup-hygiene
---

# commit:false re-run cleans up stale worktree/branch/draft PR

## Problem

A `commit: false` re-run resets the spec delta but leaves the prior attempt's
worktree, branch, and stale draft PR behind. That cleanup was scoped out of the
original reset work and remains uncovered, so re-runs accumulate stale
artifacts.

## Direction

Fold worktree/branch/stale-draft-PR cleanup into commit:false re-run hygiene so
a re-run starts from a clean slate. The committed (`git: true`) path reuses its
worktree/PR and is unaffected.

## Prerequisites

- The commit:false re-run auto-reset un-ticks acceptance criteria and strips an appended blocker from the source spec before the agent re-runs.

## Blocker

The cleanup target does not exist in the run mode the intent names. The intent
equates `commit:false` with `git: false` (Direction: "the committed `git: true`
path ... is unaffected"), and the prerequisite ties to the auto-reset feature,
which is gated `!gitEnabled` throughout (`v1/src/modes/patch/no-commit-delta.ts`,
`iteration.ts:512`). But a `git: false` patch run creates **no worktree, no
branch, and no draft PR** — see `v1/docs/run-loop.md` "Loop-only mode
(`git: false`)" (lines 608–619): "No worktree is created"; "No per-subspec
commit, push, draft PR open ... happens." The only worktree/PR creators in the
patch path are `ensureWorktree` (`preflight.ts:159`) and `ensureDraftPr`
(`iteration.ts:1269,1363`), all guarded by `gitEnabled`. So a commit:false
re-run leaves no such artifacts to clean up; the worktree/branch/PR exist only on
the `git: true` path, which the intent declares out of scope (it reuses them by
design).

The two behaviors are mutually exclusive by the `gitEnabled` flag — auto-reset
runs only when `git: false`, worktree/PR creation only when `git: true` — so they
never coexist. The original reset spec
(`spec/completed/2026-06-23T16-02-01Z-commit-false-rerun-spec-reset/`) listed
"Worktree reuse/cleanup (separate behavior)" as out of scope and described the
model as "operator-merges-only, one-PR-per-item," implying commit:false runs
produce PRs; that framing does not match the implemented loop-only `git: false`
mode (no PRs/worktrees). No code path was found where a `!gitEnabled` patch run
produces a worktree, branch, or PR.

To proceed, clarify one of:

1. Which run mode actually accumulates the stale artifacts. If it is `git: true`
   external-spec (`modes.plan.commit: false`) re-runs whose worktree/branch/PR
   reuse is broken, restate the intent against the `git: true` path and drop the
   auto-reset prerequisite (auto-reset never runs there).
2. If the target really is the `git: false` loop-only mode, identify the concrete
   stale artifact it leaves behind (the implementation creates none), or revise
   the intent — there may be nothing to do.
3. If `commit:false` here means something other than `git: false`, define it and
   point to the code path that creates the worktree/branch/PR under that mode.
