## Verdict — refinement required

The spec's schema half (a persisted admitting-process identity of pid + process-start epoch, nullable column, forward-only migration, no backfill) is sound and should survive refinement. The predicate half, the problem statement, and the acceptance criteria do not.

### 1. Correct the problem statement — the sweeper is never the admitting process

`reconcileOrphanedRuns` is called synchronously inside `startDaemon` (`v2/src/daemon/daemon.ts:1122`) **before** the IPC server starts (`:1182`), and admission only happens through the IPC `start`/`resume` RPCs. A daemon therefore cannot already have admitted a run when its own sweep runs. The guarantee the spec offers — "rows admitted by this process are never candidates" — is already true of the code as written, so as drafted the spec changes nothing about the observed incident.

Whatever killed the 01:57 runs at 02:00 was a *different* process: a second daemon start, or a daemon start racing a foreground `jarvis write` (`write-loop.ts` opens the same store and calls `createRun` directly, as does `workflow-runner.ts`). Under `daemon_identity <> :current`, that second process still sees a foreign identity, still concludes "not mine," and still kills live runs. The refined spec must state the failure in these terms: *a starting process kills another live process's in-flight runs.*

### 2. The candidate rule must distinguish a dead prior incarnation from a live concurrent owner

Identity mismatch alone is insufficient (see above). The predicate must additionally establish that the recorded owner is *gone* — e.g. `identity IS NULL OR (identity <> current AND owner is not alive)`. The spec must pin how liveness of a recorded identity is determined (pid still exists *and* its start epoch still matches — bare-pid probing is unsafe under pid reuse, which is exactly why pid+epoch is the right identity) and what happens when the epoch cannot be read for a live pid. The current ledger dismisses a liveness probe as "the race being fixed"; that conflates admission-vs-scan (a race on *current* state) with probing the *recorded* owner (a different question, and the only one that separates dead from live). Rewrite that entry.

This also makes the identity choice genuinely load-bearing rather than incidental: a random UUID could not be probed. Record that as the reason pid+epoch is required.

### 3. Decide and name the non-daemon writer case

`jarvis write` and the workflow runner create run rows in-process with no daemon at all. They will stamp a column named `daemon_identity`, which is a lie. Rename the column to what it is (the process that admitted the run) and state explicitly what a starting daemon does to a row owned by a *live* foreground write.

### 4. Rewrite the existing-tests AC — it asserts the opposite of what will happen

Every test in `v2/src/daemon/daemon-reconciliation.test.ts` seeds rows through the current process's store and then reconciles in that same process. Under any identity-scoped predicate those rows stop being candidates, so "every existing test stays green" is false. The pending-retry case at `:116` is the sharpest counterexample: it reconciles three times in one process, precisely the situation the ledger claims cannot occur ("a pending row's identity is a prior incarnation by construction"). The AC must say the tests are *reworked* to seed a prior-incarnation identity, and state the new invariant they pin.

### 5. Pin the test mechanic for simulating a prior incarnation

The `openStateStore` identity-override decision names the seam but not how it is used. Pin the mechanic (seed via a store opened with identity X; reconcile via a store opened with identity Y against the same database file, injected into `startDaemon`'s existing `stateStore` parameter), since it determines how much of the existing test file moves. Also pin how the current process's identity is derived (captured once at module init), because the pid-reuse argument depends on its stability across calls.

### 6. AC #4 is a tautology

"Two identities from the same pid but different start epochs compare as different incarnations" tests string inequality. The property worth pinning is that the liveness check classifies a same-pid-different-epoch owner as *dead*, and a same-pid-same-epoch owner as *alive*.

### 7. Minor

The `v1-behaviors.md` documentation item is a hollow conditional. Either drop it or state the finding directly (v1 has no daemon; no reconciliation behavior changes).

### Not upheld

Splitting the subspec. Column + migration + predicate + liveness + reworked tests remains one atomic, independently reviewable change; no split is required.