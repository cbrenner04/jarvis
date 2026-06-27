## Verdict

### Required outcome 1 — Remove the dead boundary-named no-op

`assertNoCommitExternalSpecBoundary` in `v1/src/modes/plan/boundary.ts` is now an exported function that unconditionally returns `{ ok: true }` with two `_`-prefixed unused params, and it has zero callers (the no-commit branch in `run.ts:1189` and `review.ts:479` calls `assertTargetRepoPlanBoundary` instead). This directly contradicts the spec's load-bearing decision that external-storage detection is *removed, not preserved*. A retained function whose name asserts a boundary but whose body always passes is a zombie: a future maintainer re-wiring it by name gets a silent pass with no compiler signal — exactly the footgun the "removed" framing was written to prevent.

**Must be true:** No boundary-named symbol survives as an unconditional pass. Delete `assertNoCommitExternalSpecBoundary` outright (and any now-unused imports/types it pulled in). `typecheck` and `test` must stay green.

### Non-blocking — routing/seed framing coherence (note, not a gate)

The subspec (`00-…md`) and the prior verdict correctly describe the change as **removal**. The `index.md` title and `intent.md` Behavior section still describe it as "scoped to the plan's own spec dir" and assert that "a plan that genuinely writes outside its own spec dir still trips the violation" — a guarantee that no longer holds for external storage. The authoritative honest ledger (the subspec) is already correct, and repo convention discourages editing `index.md`; `intent.md` is a historical seed. Surface this incoherence but do not block on rewriting the timestamp-named routing/seed artifacts.

### Not upheld

- **Concurrency test gap (AC #2):** AC #2 is satisfiable by construction — the run-start snapshot + sibling-diff mechanism that produced the false positive is gone, so no mechanism remains that could flag a concurrent sibling. The surviving guard (`assertTargetRepoPlanBoundary`) is directly unit-tested per AC #3. A two-process regression test would be a nicety, not a correctness requirement; the spec explicitly dropped the enumeration tests as coverage-dropped-not-replaced. No action required.
- **Residual whole-checkout `spec/` probe on `commit:false`/`git:true`:** Pre-existing behavior, explicitly out of scope (the spec leaves the in-checkout guard unchanged), and arguably correct — a stray uncommitted `spec/` write in the live checkout *should* block. Not introduced or worsened by this change. No action required.