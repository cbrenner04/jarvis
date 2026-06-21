## Verdict

Uphold the following refinements. The core construction — adding an analogous process-table seam to the watchdog snapshot path while preserving the real grandchild-kill assertions — is sound and stays as designed. No scope expansion into elapsed/kill timing. Required refinements are prose, precision, and one diagnostic hedge.

### Required refinements

1. **Record the prior-art lineage (highest value).** The Problem section must state that this spec is the sanctioned escalation of the prior stabilize spec's deferral: that spec widened the timeout (`1500→4000ms`) as a partial fix and explicitly deferred this descendant-table injection as the structural follow-up. Without this, an implementer reading only this spec cannot know the 4000ms is a prior partial measure or why widening alone was deemed insufficient.

2. **Restate "done" as structural determinism + one green run.** AC #5's "repeatably" is unverifiable — a single Jarvis suite run cannot prove a flake is gone by passing once. Redefine the gate the way the prior spec did: the descendant-alive assertions no longer read spawn/reap timing as a pass/fail axis (structural determinism), plus one green full-suite run. Drop or reframe "repeatably."

3. **Record the single-cause diagnosis as a falsifiable hedge.** The Verification goal (whole-suite green) rests on the snapshot read being the dominant flake axis, while ACs scope to ~2 assertions. Add one Decisions line stating the diagnosis explicitly: the snapshot read — not the `elapsedMs <= 7200` bound (which carries ~3000ms slack) nor the kill/reap path — is the load-bearing race; if a green suite does not follow, the elapsed bound is the next axis. This converts an implicit assumption into a recorded, falsifiable one and covers the agent-only-stall test's unconfirmed transient-descendant mechanism under the same hedge.

4. **Correct the "route through existing seam" framing.** The snapshot path (`snapshotWatchdogDescendantsAlive` → module-level `listProcesses()`) has no existing seam; the tracker's DI is a separate path not on the snapshot path. The Problem section's "the snapshot path just never routed through it" is misleading. Reframe as adding a *new, analogous* `listProcesses`/`collectSubtree` seam. Do not unify through the tracker — that is artificial coupling; a parallel seam is the smaller, honest change.

5. **Decide and state the 4000ms disposition.** The prior spec chose 4000ms so the real descendant is reliably alive at snapshot time; injection removes that rationale, leaving the value's purpose silent. Make an explicit keep-or-reduce decision (keeping it is the lower-churn choice, and the kill path still needs the real child spawned) and state it, noting that keeping it means the `elapsedMs <= 7200` exposure persists by design.

6. **Pin the provider signature.** Decision #2 hedges between `(rootPid) => ProcInfo[]` and `() => ProcInfo[]`. Pin it to `(rootPid: number) => ProcInfo[]`: the true case needs `rootPid` because the pgid is assigned dynamically at spawn; the false case is satisfiable by ignoring the arg. One signature serves both.

### Rationale

These do not change the approach the intent mandates (#15 DI seam, preserved assertions, test-only seam with production default = real `listProcesses()`). They close the gap between a ~2-assertion scope and a whole-suite Verification goal by recording the diagnosis that justifies it (spec-guidance: criteria and decisions must be load-bearing and verifiable), fix two prose claims that misdescribe the code an implementer will touch, and pin the one under-specified seam detail. Refinements 1 and 2 are the genuine merge blockers; 3–6 are cheap precision fixes.