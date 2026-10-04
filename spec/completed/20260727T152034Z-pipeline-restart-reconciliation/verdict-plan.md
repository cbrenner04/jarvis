## Verdict — refinement required

The two-subspec split (store layer, then daemon startup) is sound and stays. Both subspecs are independently implementable in order. The following must be addressed.

### Must fix

1. **Name the pipeline status vocabulary explicitly in `00`.** The spec repeatedly says "an initial non-terminal status" and "a terminal status" without naming a single literal, and `01` then depends on whatever `00` invents. Since `pipelines.status` is net-new state introduced by this spec, `00` must pin the complete literal set (the admission-time value, `interrupted`, and any other values it declares terminal) as a decision, and `01` must reference that vocabulary rather than restate it abstractly.

2. **Restate the terminal-status guard AC as re-sweep idempotence.** Nothing in this slice ever writes a completed or failed pipeline status — the intent's "completed and failed pipelines are unchanged" has no reachable fixture. The only fixture an implementer can actually build is a pipeline already settled `interrupted` re-entering the sweep. Both subspecs' terminal-guard ACs must be expressed in terms a test can construct (a second sweep leaves the settled pipeline and its stages untouched), while keeping the guard-inversion requirement.

3. **Address schema migration and column defaults.** `pipelines` is created by migration `013-pipelines-and-stages`; adding owner identity and status requires a new forward-only `ALTER TABLE`, and SQLite rejects `NOT NULL`-without-default on `ADD COLUMN`. `00` must state the migration, the nullability/default of each new column, and — as an explicit decision — that a null recorded owner is treated as orphaned, matching the existing precedent in `011-run-owner-identity` (`state-store.ts:753` pushes `ownerIdentity === null` straight to orphaned, with no backfill). Right now that behavior is assumed, not decided.

4. **Supersede the stage-status doc contract, not just the pipeline-status one.** `v2/docs/state-store.md` currently states that `pipeline_stages.status` is free-form and that "the daemon consumer defines the vocabulary," while `00` puts stage classification *and* the `interrupted` write inside the store. `00` already explicitly supersedes the adjacent "no pipeline-level status column" sentence; it must treat this identically — name the stage-vocabulary contract in its Documentation updates and say what replaces it. The placement itself is fine (one transaction over pipelines plus stages requires it); the doc contract just can't be left contradicting the code.

5. **Fix `01`'s two unverifiable acceptance criteria.**
   - "The daemon does not accept new pipeline work until reconciliation completes" has no observation surface: no admission path exists in this slice. Replace with the ordering fact that *is* observable — the sweep completes before the socket accepts connections.
   - "No pipeline row is read or written by request handling before the sweep completes" is a negative universal an implementer can only tick by inspection. Drop it; the ordering assertion above covers the real contract.
   - `01`'s guard-inversion AC targets the ownership and terminal guards, which live in `00`'s store code. `01`'s own guard is ordering; scope its inversion AC to that.

6. **Define the preservation comparison surface.** "Preserves prior terminal stages byte-for-byte" needs a named surface an implementer can compare against (e.g. the full stage rows as returned by `loadPipeline` before and after the sweep). As written it's unfalsifiable.

### Should add

7. **Decide the uncovered lifecycle shapes.** Three combinations are currently unaddressed by any decision or AC:
   - Pipeline non-terminal with a dead owner but *all* stages already terminal. Marking it `interrupted` is defensible, but the intent explicitly rules out fabricated completion, so the mirror case needs a stated decision rather than silence.
   - Daemon died *between* stages: no active stage, later stages `pending`. Covered by the decisions but pinned by no AC. Add one.
   - **Who stamps the owner.** `00` assumes the daemon calls `createPipeline`; if a short-lived CLI process were the admitter, every pipeline would self-orphan on the next startup. State this as a decision, matching `createRun`'s stamping.

8. **Record the observability scope call.** Run reconciliation emits a `run_reconciled` event backed by a `reconciliation_pending` flag; pipelines get none of that here. That's a defensible scope boundary — no pipeline log stream and no consumer of the returned IDs exist yet — but it must be written as an explicit deferral rather than left as an unexplained asymmetry. Correspondingly, narrow `00`'s "matching `beginRunReconciliation`" claim to the ownership/liveness predicate, which is the only part it actually matches.

9. **State that verification is against seeded state.** `createPipeline` and stage updates have no non-test callers in `v2/src` today, so every acceptance criterion here is exercised against rows a test seeds directly. One line saying so — plus a note that no consumer currently derives pipeline status from its stages — keeps a reviewer from hunting for an integration path that doesn't exist, and justifies why a stored status column supersedes the derived-status contract.

### Rejected

- A `## Task checklist` section is not required; the index + Decisions + Acceptance shape is this repo's norm and the checklist would restate both.
- No structural change to the split, and no re-scoping of the slice. The absence of an admission consumer is the declared shape of the slice (the intent's Prerequisites and its "deferred to first consumer" line say so); it needs disclosure, not restructuring.