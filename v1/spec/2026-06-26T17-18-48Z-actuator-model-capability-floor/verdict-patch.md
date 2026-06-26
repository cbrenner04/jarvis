Confirmed the core regression and the test gaps. Issuing the verdict.

---

## Verdict — required outcomes

### 1. Empty-eligible patch floor error must not leak the worktree lock (correctness — blocking)

When the capability floor excludes every configured `modes.patch.agentOrder` entry, the patch run currently emits the floor error and returns exit 1 *after* preflight has created and locked the worktree, but *before* the `try/finally` that releases the lock (the lock is released only in `finalize`). The early return therefore leaves a stale worktree lock, forcing the next run on that spec into stale-PID recovery. This is a regression introduced by this branch.

Required:
- A floor that excludes all configured actuators must exit 1 **without leaving the worktree locked** (and without other leaked preflight resources). Because eligibility is a pure static comparison of `actuationCapabilityFloor` against `agentOrder` capabilities, it needs nothing from the worktree — detect it before lock acquisition, or guarantee the lock is released on this path.
- Subspec 01 specifies this error is "a fatal preflight error … surfaced **before any agent runs**" and "emitted on stderr **with the run's telemetry**." Both must hold: the error names the actuation role and the floor on stderr, fires before any agent invocation, and the run is recorded in telemetry (a run row) rather than vanishing before logging is set up. Reconcile the "before any agent runs" and "with telemetry" guarantees deliberately — do not satisfy one by dropping the other.

### 2. Test the load-bearing floor behaviors that were ticked without coverage (blocking)

Acceptance criteria across subspecs 01 and 02 were checked, but several have no test. The repo convention requires tests pass before AC are ticked, and the untested run-level path is precisely what let issue #1 ship. Add tests establishing:

- **Floor × tier composition** at a non-trivial tier (`standard`/`hard`): with a floor set, initial selection lands on the first floor-eligible agent *at or after the tier start index* (the start index resolves against the floor-eligible ladder). This is the headline composition decision the plan flagged and is currently untested.
- **Run-level empty-eligible exit** (AC 01 #4): the run exits non-zero with the role+floor error before invoking any agent — and, per outcome #1, without leaking the lock.
- **Shrink floor behavior** (subspec 02, currently zero tests): shrink selects/falls back only among floor-eligible entries; empty-eligible surfaces the named `shrink actuation` floor error and skips shrink while the completed run's outcome/exit is preserved; floor-unset path unchanged.

The fallback-never-below-floor and review-reuses-ladder cases are structurally guaranteed by filtering-at-construction and are lower priority, but the three above must be covered.

### 3. Correct the inaccurate run-loop doc (blocking, cheap)

`v1/docs/run-loop.md` states the floor is "applied once at preflight … all phases (iteration, review, shrink)." That is wrong for shrink: shrink re-filters `modes.patch.agentOrder` independently — that independence is the entire reason subspec 02 exists, and `v1-behaviors.md` already records it correctly. Fix the sentence so it states the floor is applied once via the active ladder for iteration/review and re-applied independently for shrink. Docs must match behavior.

### Recommended, not blocking

- Hoist shrink's eligibility check above the pre-shrink ready gate and other setup so an unsatisfiable floor short-circuits next to the `shrink === "off"` check rather than paying setup cost first. Functionally harmless today (outcome preserved), but wasteful.

### No action required

- The coupling load error naming the entry by agent name (rather than numeric index) satisfies AC 01 #3 ("naming the offending entry") and is more legible; prose drift only.
- `buildActiveAgents` returning `[]` as the floor-error signal is correct given a validated non-empty `agentOrder` and identity filter when the floor is unset; restructuring is unnecessary (and outcome #1's fix may dissolve the concern incidentally).