---
name: terminal-runs-do-not-block-worktree-retirement
---

# Terminal runs do not block worktree retirement

Cleanup's eligibility gate must block only on **non-terminal** durable runs. Today it uses the
completion-boundary predicate (`isBoundaryTerminalRunStatus`), which excludes `killed`, so any
`(project, branch)` with a `killed` row is ineligible forever — including every row settled
`killed` / `daemon_restart` by startup reconciliation after a daemon bounce. The spec on such a
branch is then permanently unarchivable, since a materialized worktree owns it.

## Decisions

- The gate blocks on non-terminal statuses only; state the rule rather than special-casing `killed`.
  Rules out keeping the boundary-terminal predicate here — it answers a different question
  (what a committed completion boundary may leave) and is correct for its own callers.
- Daemon `isLive` in `checkEligibility` still refuses retirement regardless of durable status.
  Live `.jarvis.lock` refusal stays in `runAbandonCommand` / `isWorktreeLiveHeld`, not in bulk
  merged-worktree retirement via `checkEligibility`.
- Fail-closed: `gh` failure and daemon unreachable → ineligible (unchanged). `listRuns()` throw →
  propagates; cleanup aborts — not per-worktree ineligible like gh/daemon.

## Acceptance criteria

- [x] A worktree whose branch has a terminal `killed` run and a merged PR is eligible; a test
      asserts eligibility and fails against the pre-fix gate.
- [x] Non-terminal runs (`in-progress`, `paused`, `queued`, `budget-soft-stopped`) still make the
      worktree ineligible; a test covers each and inverting the terminal check fails them.
- [x] A live daemon run still refuses retirement when every durable row is terminal; a test asserts
      the probe is independent of durable status.
- [x] `runAbandonCommand` still refuses a worktree held by live `.jarvis.lock`; bulk eligibility
      does not read the lock.
- [x] `gh` failure still marks ineligible (`returns ineligible if gh command fails` stays green).
      `listRuns()` throw propagates (`propagates when listRuns throws` in `eligibility-gate.test.ts`).

## Documentation updates

- `v2/docs/operator-runbook.md` — § Cleanup: eligibility gate: blocking list is non-terminal
  statuses only; note `--abandon` was the workaround before this shipped.
- `v2/docs/v1-behaviors.md` — record the changed eligibility-gate behavior: `killed` (and other
  terminal statuses) no longer block worktree retirement.

## Prerequisites

- Cleanup's worktree eligibility gate consults durable run status for the `(project, branch)`

## Out of scope

Same-invocation archival after retirement — owned by `cleanup-archives-in-the-invocation-that-retires`.
This intent fixes eligibility only; a retired-but-unarchived spec is archived on the next cleanup.
