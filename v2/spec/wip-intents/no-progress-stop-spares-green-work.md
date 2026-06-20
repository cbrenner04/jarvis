# No-progress stop misfires on complete-but-unticked iterations

## Problem

The diagnostic no-progress stop halts a patch run when an iteration edits files but ticks no new acceptance criteria (treats edits-without-AC-progress as stuck). It misfires when the agent completed the whole subspec in one iteration but didn't tick: the work is green (typecheck + test pass) yet unticked, worktree dirty, no commit, no PR. The operator must manually re-run to finalize, so completing a one-subspec spec routinely costs **two full agent runs**.

## Evidence (this session)

- `idle-output-watchdog-2`: first run produced a complete, green implementation (typecheck + 1182 tests) with zero ACs ticked and a dirty worktree; a plain re-run ticked and finalized (PR + review + ready).
- `shared-spec-blocker-parsing`: identical — first run wrote the shared parser, relocated review-gate, deleted the old files, full suite green (1217), ticked nothing; re-run finalized. Harness line: `iteration 1 edited files but checked no new acceptance criteria ... worktree is not clean`.

## Direction (characterize before fixing)

When an iteration makes edits but ticks no new ACs **and** the gates are green, the run should not hard-stop as no-progress — give the agent a bounded verify-and-tick iteration instead. Distinguish genuinely stuck (edits, no AC progress, gates red/uncertain) from done-but-unticked (edits, no AC progress, gates green). Root-cause first: is the agent ending its turn before ticking, or is the iteration cap/stop firing one step too early?

## Out of scope

- Harness auto-ticking ACs without the agent — explicitly deferred elsewhere (harness can't judge criteria). The fix here is to let the agent finish ticking, not to tick for it.
- The separate completion `check:fix` → dirty-tree → fix-up churn (the loop C hit); related completion-pipeline robustness, but a distinct cause.
