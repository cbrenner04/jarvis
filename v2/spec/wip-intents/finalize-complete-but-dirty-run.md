# Don't waste a complete run at the finish line: commit a complete-but-dirty worktree + idle-kill a hung finish

## Problem

Observed finalizing seed 1 (transient-agent-error-retry, run #335): the agent did
**correct, lint-clean, fully-tested** work and ticked every acceptance criterion — but
the run still exited non-zero and had to be hand-finalized. Two harness gaps, not a model
gap, caused it:

1. **The harness asked the agent to commit instead of committing itself.** With all
   checklists complete but one uncommitted file in the worktree, the completion path
   printed "commit and push from the worktree" and spent another agent turn on it. Yet the
   harness already does `git add -A` commits on other paths — the ready-gate commits
   `check:fix` output, and [[spare-green-unticked-iteration]] (#9) commits uncommitted
   *ticks* at iteration start. #9 covers uncommitted ticks but **not uncommitted code**:
   a complete-but-dirty worktree should be committed by the harness, not delegated back to
   the agent.
2. **A silent hang burned the full 30-min iteration timeout.** That extra "go commit" turn
   hung producing no output and rode the 1800s wall-clock iteration timeout
   (`last_output_age_ms=null`). The idle-output watchdog (`idleOutputTimeoutMs`, shipped in
   watchdog-2) exists for exactly this but is **default-off**, so the stall cost 30 minutes
   instead of seconds.

3. **The idle watchdog is patch-only — review/shrink/plan aren't covered.** Run #339
   (base-ref-validation) hung in the **review actuator** (`review: actuator running with
   verdict`, ~16 min silent) and rode the 30-min wall timeout, because
   `idleOutputTimeoutMs` is wired only in `v1/src/modes/patch/iteration.ts`. Even with the
   flag enabled, a hang in the review debate/actuator, shrink, or plan still rides the full
   `iterationTimeoutMs`. The idle watchdog must cover every agent-spawning phase, not just
   the patch iteration loop.

Net: finished/near-finished runs were thrown away or delayed; #335 required manual commit +
verify + merge, #339 lost ~30 min to an uncovered review-actuator hang.

## Direction

Both levers reuse machinery that already exists:

- **Commit the complete-but-dirty worktree.** When the spec's checklists are complete and
  the only thing standing between the run and success is an uncommitted/dirty worktree,
  have the harness commit it (reuse the existing `git add -A` commit helpers) and re-run
  the completion gate, rather than emitting "commit and push" and spending an agent turn.
  Never auto-*tick* (that line stays the agent's) — this is committing already-done work,
  the code analogue of #9's uncommitted-ticks handling.
- **Turn the idle-output watchdog on by default for runs** (or default `idleOutputTimeoutMs`
  to a sane value), so a finish-line hang dies in seconds instead of riding the 30-min
  iteration timeout. This is also general: any silent stall, not just the finish line.
- **Extend idle-watchdog coverage to every agent-spawning phase** — review (debate +
  actuator), shrink, and plan — not just the patch iteration loop, so a hang anywhere in the
  pipeline is caught by `idleOutputTimeoutMs` rather than only the patch path.

## Out of scope

- Auto-ticking acceptance criteria — harness still never judges criteria.
- The changing-failure / spin bounds (#10) and edited-but-unticked retry (#9) — this is the
  sibling case: complete + dirty code, and the idle-kill that should have ended the hang.

## Documentation updates

- `v2/docs/v1-behaviors.md` — harness commits a complete-but-dirty worktree; idle watchdog
  default.
- `v1/docs/run-loop.md` and the watchdog docs — the idle-default change.

## References

- Evidence: jarvis run #335 (transient-retry) — iteration 3 hung, watchdog iteration
  timeout fired at 1800000ms; `M v1/src/agents/spawn.ts` left uncommitted despite all ACs
  ticked.
- `v1/src/modes/patch/iteration.ts` — the "spec checklists are complete, but the worktree
  is not clean" path (where the harness should commit instead of instruct).
- watchdog-2 / `idleOutputTimeoutMs` (default-off today); `v1/src/ready-gate.ts` commit
  helpers to reuse.
