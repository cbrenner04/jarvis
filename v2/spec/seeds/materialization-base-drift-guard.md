---
name: materialization-base-drift-guard
---

# Materialization fails loudly when the worktree base drifts from `--base`

**Demoted to seed 2026-07-26.** Defense-in-depth against a symptom whose known mechanism is the
stale `origin/<branch>` tracking ref — owned by `stale-remote-tracking-ref-no-longer-resolves-branch`,
which removes it. Reassess only if base drift is observed again *after* that intent ships.

## Problem

On 2026-07-25 a `jarvis run workflow implement --base main` re-dispatch materialized a worktree at
pre-merge history (`94ccc2d7`) while `--base main` was `e8b85b13`. Nothing checked, so the run
implemented an outdated spec tree and ticked criteria against an index `main` had already replaced.

Materialization (`v2/src/execution/external-worktree.ts`) resolves either an existing branch ref or
`--base`, but never records which ref it resolved or what commit the worktree came up at, and never
compares the result to the requested base.

## Decisions

- Record the resolved ref and the resulting worktree base commit at materialization. Consumer is the
  drift guard below, not speculative telemetry.
- When materialization creates a *new* branch, its base commit must equal the resolved `--base`
  commit; a mismatch fails with a named error before the write step. Rules out letting a run proceed
  and discover drift only in review.
- Reused/existing-branch worktrees legitimately carry commits ahead of `--base`; the guard compares
  the branch's base, not tip equality. Rules out a guard that breaks every resume.
- Deferred to first consumer: whether the error is recoverable (auto-reset) or terminal — pin when a
  caller needs it; this intent fails loudly only.

## Acceptance criteria

- [ ] Materialization records the ref it resolved and the commit the worktree is based on.
- [ ] A materialized base that differs from the resolved `--base` commit fails with a named error
      before the write step; inverting the guard fails a test.
- [ ] Resuming an existing branch that is legitimately ahead of `--base` still materializes.

## Documentation updates

- `v2/docs/operator-runbook.md` § Recovery — how to confirm a run's worktree base matches `--base`,
  and what the named drift error means.
- `v2/docs/v1-behaviors.md` — materialization now gates on base drift.

## Prerequisites

- Worktree materialization creates run worktrees from an existing branch ref or from `--base`
- Runs accept a `--base` ref that is resolved at dispatch time

## Sequencing

Same seam as [[stale-remote-tracking-ref-no-longer-resolves-branch]] (`external-worktree.ts`).
Plan this one second, against that intent's merged result — it fixes the underlying stale-ref cause;
this intent is a belt-and-suspenders guard on the same materialization path, not a substitute.
