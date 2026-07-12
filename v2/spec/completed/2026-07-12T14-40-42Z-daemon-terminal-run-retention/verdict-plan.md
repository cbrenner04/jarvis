## Verdict — refinement required

**1. Workflow step snapshots break under the filter (blocking).**
`listHandler` builds the workflow step-status map from the same durable-run set it renders. Dropping terminal rows before that map is built makes completed step runs vanish from the map, and the snapshot code reports absent steps as `pending` with zero attempts. A live workflow (exempt, always returned) would therefore report its finished steps as pending. This is wrong data, not just truncation, and no existing test catches it (the workflow-snapshot tests use a handful of runs).

Required: the spec must resolve the tension between "drop retired rows before `loadRun`/`tail`" and correct workflow step composition — state a decision for how step runs belonging to a still-listed invocation are preserved, and add an acceptance criterion that a workflow whose step runs fall outside the terminal bound still reports accurate step statuses (not `pending`). The cost decision must be restated to match whatever the correctness fix requires, and the `loadRun` call-count criterion rewritten alongside it rather than left contradicting it.

**2. Strike the false rationale.**
The claim that "other `listRuns` callers want the full set" is untrue — `store.listRuns()` has one production caller. Keep the per-status-class argument (which is sound and sufficient) and remove the false clause.

**3. Own the arbitrariness of 50.**
Count-vs-age is correctly resolved (the 1 Hz TUI poll is the consumer that pins it, so the intent's deferral is discharged). The *value* is not derived. Say so: arbitrary starting point, module constant, cheap to change. Do not invent a derivation.

**4. Name the accepted trade on non-terminal exemptions.**
`paused` and `budget-soft-stopped` never auto-transition, so abandoned runs in those states are exempt forever and consume no cap slots. Keeping them visible is right (an invisible paused run can't be resumed or killed), but the spec claims to bound list growth when it bounds only the terminal class. Record that limit as a named trade in the ledger.

**5. Fix the weak/unverifiable acceptance criteria.**
- Ordering across the mixed result is operator-visible and unstated: assert that the returned set stays in global `created_at DESC` order with exempt and retained terminal rows interleaved.
- "no client-side truncation of their own" is not verifiable as written — restate as a positive claim about what the two consumers render, or drop it.
- The `loadRun` call-count criterion must admit the real bound (terminal cap plus exempt rows plus whatever finding 1 requires), not a bound that only holds when zero exempt runs exist.
- `created_at` ties are untiebroken in `listRuns`, while sibling queries in the same store already tiebreak on `rowid` — meaning the 50th/51st boundary this spec creates is nondeterministic. Either add the same tiebreak (and correct the "store is unchanged" decision to say so) or explicitly accept the nondeterminism; do not leave it unaddressed.

**6. Drop or restate the `daemon-start-list.test.ts` criterion.**
That test does not pin unbounded history, so "stays green (unbounded-history behavior is the only change)" is misleading. Per the refactor-AC convention, cite what it actually pins or remove it.

**No split.** One implementation path, one doc target; the finding-1 fix adds a decision and a criterion, not a second subspec. `v1-behaviors.md` does not apply (net-new bound on v2 daemon behavior).