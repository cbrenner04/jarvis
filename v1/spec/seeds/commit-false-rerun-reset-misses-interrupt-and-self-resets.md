---
name: commit-false-rerun-reset-misses-interrupt-and-self-resets
---

# commit:false re-run auto-reset misses the interrupt case and self-reverts mid-run

## Problem

The no-commit re-run auto-reset shipped
(`v1/src/modes/patch/no-commit-delta.ts`,
`commit-false-rerun-spec-reset`) — it un-ticks acceptance criteria and strips an
appended `## Blocker` from the source spec before the agent runs. But the
shipping spec's **own verdict flagged two acceptance criteria as unmet**, and
the gaps are exactly the reporter's pain (intake issue #520):

- **Interrupt/timeout loses the delta.** The delta is recorded only on a graceful
  `result.kind === "ok"` return; SIGINT/timeout paths return *before*
  diff-and-record. The headline case — operator Ctrl-C's a `commit: false` run —
  leaves ticked AC + an appended blocker that the next re-run does **not** reset.
- **Multi-iteration run reverts its own progress.** The reset block
  (`v1/src/modes/patch/iteration.ts` ~412-452) runs on every non-fixup iteration
  with no once-per-run guard, so iteration 2 reloads this run's own delta and
  un-ticks AC the agent just completed — undoing in-flight progress.

Separately, worktree/branch/stale-draft-PR cleanup on a `commit: false` re-run is
still uncovered (was scoped out of the original spec).

## Direction

- Capture/persist the delta on the **interrupt and timeout** paths (or persist
  mutations incrementally), so a killed run is reset on re-run.
- Guard the reset to **once per run, at run start** — never re-apply against the
  run's own in-flight progress.
- Consider folding worktree/branch/stale-draft-PR cleanup into the same re-run
  hygiene.

## Out of scope

- The committed (`git: true`) path, which reuses the worktree/PR and is unaffected.

## References

- `v1/src/modes/patch/no-commit-delta.ts` — delta save/load + blocker strip.
- `v1/src/modes/patch/iteration.ts` (~412-452) — reset integration point.
- Completed `commit-false-rerun-spec-reset` (verdict: AC #2/#3 unmet).
- Intake issue #520.
