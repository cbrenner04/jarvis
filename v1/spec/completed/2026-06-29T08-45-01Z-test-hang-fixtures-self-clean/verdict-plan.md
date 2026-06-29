## Verdict: required refinements

### Blocking — must resolve before implementation

1. **`exec tail -f /dev/null` vs parent-death self-clean**  
   In-scope bodies end with `IDLE_HANG_WAIT = "exec tail -f /dev/null"`. Parent-death logic placed before `exec` never runs at stall time. The spec must decide how parent-death and the zero-CPU blocking wait coexist (e.g., background poll then `exec`, replace `exec` with an equivalent blocking wait, or a single compose layer wrapping `WAIT`) and name the attachment point so `agent-only-hang.sh` (bare `WAIT` only) is covered.  
   *Rationale:* Without this, ACs can pass while the orphan scenario the intent describes remains unchanged.

2. **Define “parent death” for script self-clean**  
   Hang helpers are spawned through a multi-process chain (test → jarvis → agent script → `tail`). The spec must state which PID the script watches (likely the immediate bash parent or the test-spawned process), that the parent-death AC is an isolated direct-spawn test (not full jarvis-stack semantics), and which abnormal exits each defense covers (throw/early exit vs `--bail` vs operator interrupt).  
   *Rationale:* “Parent death” is ambiguous; implementers can satisfy AC wording without matching the failure modes that leak orphans.

### High — align decisions, tasks, and ACs

3. **Reconcile dual defense with verification**  
   Decisions require parent-death **and** bounded lifetime; ACs verify only parent-death and teardown. Either narrow Decisions to “parent-death required; bounded-lifetime hook present, bound chosen by implementer, unpinned until needed” **or** add an AC that a helper exits within a grace window when the parent stays alive past the implementer-chosen bound. If lifetime stays load-bearing, state explicitly that it is the backstop when per-test teardown cannot run (`--bail`, interrupt) or cannot see another file’s orphans under parallel load.  
   *Rationale:* Intent’s dual defense is load-bearing for interrupt/bail and parallel orphans; current ACs under-verify it.

4. **Pin wrapper attachment at `WAIT` or shared compose**  
   `agent-only-hang.sh` is built from `IDLE_HANG_WAIT` alone, not `IDLE_HANG_BODY`. Tasks/Decisions must require wrapper application at `IDLE_HANG_WAIT` or a single compose function used by both `BODY` and bare-`WAIT` call sites — not `BODY`-only.  
   *Rationale:* BODY-only patching misses a named in-scope fixture and a preservation AC site.

5. **Mirror teardown scope to apply scope**  
   Teardown Task must enumerate the same files as the apply Task: `run.sandbox-unrunnable.test.ts`, `shrink.sandbox-unrunnable.test.ts`, `review.sandbox-unrunnable.test.ts`, `run.test.ts`. Include the review actuator’s out-of-tree `idle-hang.sh` (`join(dir, "..", "idle-actuator")`): teardown must register/kill that script or its process tree explicitly; dir `cleanup()` alone is insufficient.  
   *Rationale:* Apply list is complete; teardown list is not; actuator path is a known orphan vector.

6. **Teardown registration guardrails**  
   State what gets registered (jarvis/agent child PID vs script path + descendant tree) and prefer reusing existing test reap patterns (`DescendantTracker`, `__testReapOverride`) where present — rules out parallel ad-hoc kill logic conflicting with harness reapers.  
   *Rationale:* Nested trees (`runAgent` → script → `tail`) need a consistent reap target.

7. **Assign interrupt/bail vs throw to each defense**  
   One Decisions line: script self-clean when teardown may not run (interrupt, some bail paths); per-test teardown when the test body aborts normally (throw/early exit), with script self-clean as backup.  
   *Rationale:* Dual defense intent is sound but not spelled out; implementers may rely on `afterEach` alone.

### Medium — reduce flake and ambiguity in new-behavior ACs

8. **Pin grace window for parent-death AC**  
   Replace prose “short grace window” with a named constant/margin (e.g., existing `__testKillGraceMs` + headroom), consistent with hang tests already using `__testKillGraceMs: 200`.  
   *Rationale:* Unpinned grace invites flaky parent-death tests.

9. **Make teardown AC testable**  
   New-behavior AC for teardown must specify: target file(s), isolated vs full sandbox-unrunnable run, and precondition that the helper is still alive when abort is simulated (short timeout / no watchdog) so the test does not race normal watchdog kill.  
   *Rationale:* Current wording is satisfiable by tests that prove nothing about orphan reaping.

10. **Pin placement for new subprocess tests**  
    State whether parent-death/teardown tests live in `*.sandbox-unrunnable.test.ts` or elsewhere, with sandbox-off rationale if not — subprocess visibility affects `ps`/`pgrep` behavior documented in the runbook.  
    *Rationale:* Placement affects whether tests can observe process death reliably.

### Low — prose and prerequisites

11. **Fix stale problem framing**  
    Opening motivation should describe lingering PIDs/file descriptors under `jarvis-run-*` / `jarvis-patch-review-parent-*`, not “CPU-pinning” (dont-spin already replaced hot loops with `tail`).  
    *Rationale:* Accurate problem statement; avoids misleading implementers.

12. **Record accepted residual orphan risk on exempt fixtures**  
    One Decisions line: `emit-then-hang.sh`, `ignore-term.sh`, `hang-agent.sh` remain exempt; residual orphan risk on abnormal exit is accepted — rules out re-litigating during implementation.  
    *Rationale:* Exemptions are intentional; residual risk should be explicit.

13. **Strengthen prerequisite**  
    Add prerequisite that in-scope fixtures use blocking tail wait (dont-spin merged or equivalent on branch) — rules out implementing parent-death on still-hot-loop bodies.  
    *Rationale:* Ordering relative to dont-spin affects whether self-clean attaches to the right stall primitive.

14. **Runbook task remains conditional**  
    No committed `*-hang.sh` orphan stopgap exists in `v1/docs/operator-runbook.md` today; conditional no-op task/AC is acceptable. Do not add speculative runbook prose. Operator reports document pain outside the runbook — out of scope for this spec unless a stopgap is later committed.  
    *Rationale:* Intent/doc updates assume a stopgap that may never have landed; conditional cleanup is sufficient.

### Defended — no refinement required

- Single subspec atomicity for one fixture lifecycle model.  
- Harness subspec naming of internal symbols (`IDLE_HANG_*`, helpers).  
- Preservation ACs citing existing tests by name.  
- Skipping `v2/docs/v1-behaviors.md` for test-only internals.  
- Exempt fixtures matching dont-spin semantics.  
- Conditional runbook removal (no-op if no stopgap).
