# No-progress stop misfires on complete-but-unticked iterations

## Problem

The diagnostic no-progress stop halts a patch run when an iteration edits files but ticks no new acceptance criteria (treats edits-without-AC-progress as stuck). It misfires when the agent completed the whole subspec in one iteration but didn't tick: the work is green (typecheck + test pass) yet unticked, worktree dirty, no commit, no PR. The operator must manually re-run to finalize, so completing a one-subspec spec routinely costs **two full agent runs**.

## Evidence (this session)

- `idle-output-watchdog-2`: first run produced a complete, green implementation (typecheck + 1182 tests) with zero ACs ticked and a dirty worktree; a plain re-run ticked and finalized (PR + review + ready).
- `shared-spec-blocker-parsing`: identical — first run wrote the shared parser, relocated review-gate, deleted the old files, full suite green (1217), ticked nothing; re-run finalized. Harness line: `iteration 1 edited files but checked no new acceptance criteria ... worktree is not clean`.
- `plan-draft-structural-validation`: the worst case — a **deadlock**. The agent ticked subspec 01's ACs in the subspec file but the run no-progress-stopped before committing them. Every subsequent re-run then saw the ACs *already* ticked (uncommitted) → "no new progress" → stopped again *before committing* → the ticks could never land. Re-running could not converge; required manual commit + index tick to finalize. So the misfire is not merely a wasteful re-run — with ticked-but-uncommitted ACs it is a hard deadlock.

## Direction (characterize before fixing)

When an iteration makes edits but ticks no new ACs **and** the gates are green, the run should not hard-stop as no-progress — give the agent a bounded verify-and-tick iteration instead. Distinguish genuinely stuck (edits, no AC progress, gates red/uncertain) from done-but-unticked (edits, no AC progress, gates green). Root-cause first: is the agent ending its turn before ticking, or is the iteration cap/stop firing one step too early?

The deadlock variant needs its own guard: **uncommitted ticks present at the start of an iteration are progress** — the harness should commit them (and re-evaluate index completion) before deciding "no progress", rather than comparing only against the last committed tick state. A run that finds the active subspec's ACs already fully ticked (committed or not) on a green tree should advance to completion, not stop.

Related but distinct: agent ACs typically require only `typecheck` + `test`, while the completion gate runs full `bun run ready` (including `bun run check` lint). An agent can therefore ship lint-dirty-but-tests-green code, tick legitimately, and stall the completion gate on lint that `check:fix` (safe) cannot auto-fix. Either widen the per-subspec gate the agent runs, or make the completion fix-up able to apply/park unsafe lint — see [[completion-commit-checkfix-output]].

## Out of scope

- Harness auto-ticking ACs without the agent — explicitly deferred elsewhere (harness can't judge criteria). The fix here is to let the agent finish ticking, not to tick for it.
- The separate completion `check:fix` → dirty-tree → fix-up churn (the loop C hit); related completion-pipeline robustness, but a distinct cause.
