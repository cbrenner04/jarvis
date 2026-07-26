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
- Liveness stays an independent check: the daemon live-run probe and `.jarvis.lock` still refuse
  regardless of durable status. Rules out reading this as "stop checking whether a run is live".
- Fail-closed on `gh` failure, daemon unreachability, and store errors is unchanged.

## Acceptance criteria

- [ ] A worktree whose branch has a terminal `killed` run and a merged PR is eligible; a test
      asserts eligibility and fails against the pre-fix gate.
- [ ] Non-terminal runs (`in-progress`, `paused`, `queued`, `budget-soft-stopped`) still make the
      worktree ineligible; a test covers each and inverting the terminal check fails them.
- [ ] A live daemon run still refuses retirement when every durable row is terminal; a test asserts
      the probe is independent of durable status.
- [ ] A `.jarvis.lock`-held worktree still refuses.
- [ ] Retiring such a worktree archives its completed spec in the same invocation; a test drives the
      merged-PR-plus-`killed`-row case end to end and asserts the spec lands in `completed/`.
- [ ] Fail-closed paths (`gh` error, daemon unreachable, store error) still mark ineligible;
      `eligibility-gate.test.ts` "fail closed" tests (`returns ineligible if gh command fails`,
      `returns ineligible if store throws`) stay green.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Cleanup: eligibility gate: blocking list is non-terminal
  statuses only; note `--abandon` was the workaround before this shipped.
- `v2/docs/v1-behaviors.md` — record the changed eligibility-gate behavior: `killed` (and other
  terminal statuses) no longer block worktree retirement.

## Prerequisites

- Cleanup's worktree eligibility gate consults durable run status for the `(project, branch)`
- Retiring a worktree archives its completed spec in the same cleanup invocation
