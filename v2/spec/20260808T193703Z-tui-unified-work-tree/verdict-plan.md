## Verdict — refine before implement

The single-subspec shape is correct; no split. The two candidate seams (emit ad-hoc nodes into the flatten / delete the segment) cannot ship independently — an intermediate that does one without the other either double-renders every ad-hoc run or paints an unbounded segment into a clipped box. Net source change is negative. Keep one subspec; grow the enumerated inventory.

### Blocking

1. **The rank mutation checkpoint is hollow as fixtured.** Ordering compares non-terminal items by `createdAt` ascending, so promoting the terminal ad-hoc item to `running` only changes the emitted order if that item's `createdAt` is earlier than the other running items'. The current fixture description does not constrain it, and the natural creation ordering leaves the mutated output identical — completion will refuse the checkpoint as hollow. The spec must state the fixture invariant explicitly (the terminal ad-hoc item is created before every running top-level item) in both the decision ledger and the ordering AC's fixture description, mirroring the discipline the ledger already applies to the right-pane fixture ("must sort below a pipeline row").

2. **Existing `@mutate` directives anchor into text this spec deletes.** At least one directive in the TUI tests targets the selectable-window fallback that this change removes, and others anchor into functions or call sites the deletions touch. An unparseable directive (zero occurrences) blocks completion once its host file is opened. Add a task and a verification outcome: after the deletions, no `@mutate` directive anywhere under `v2/src/tui/` references removed or reshaped text — each is re-anchored or deleted with its host test.

3. **The test inventory is incomplete and mis-graded.** Three concrete corrections, each named in the spec's remove/rewrite/update lists:
   - The right-pane test covering runs outside the selectable window imports a deleted export, asserts a run is *absent* from the selectable ids, and carries a now-dead directive. Its premise is exactly what this spec abolishes — it belongs in **remove**, not update.
   - The left-pane row test whose title asserts orphans are placed *after* the tree inverts its contract (top-level row count and order both change). It belongs in **rewrite**, not update.
   - The initial-selection test in `tui-entry.test.tsx` asserting the first selectable row is the pipeline and explicitly *not* the ad-hoc run flips today: the ad-hoc run is running with an earlier `createdAt`, so unified ordering puts it first. This is a real, on-disk behavior change the spec does not currently name anywhere. Add it to the rewrite list, record the changed initial-selection behavior as a decision, and cover it in the `v1-behaviors.md` update (which currently documents the old ordering).

4. **"The queue segment is unchanged" is doing work it cannot support.** The tree viewport reserves exactly one row for the queue while the queue block emits a heading plus one row per queued item, inside a clipped pane. Pre-existing, but this change makes tree saturation the normal case rather than an edge, so the clipping becomes routine. The ledger must take the decision explicitly — accept the clipping as known and out of scope, or reserve the full queue height — rather than asserting the queue is untouched.

5. **The runbook wording mandated by the docs AC overclaims "first-class."** Typed steering (`pause`/`kill`/`resume`/`approve`/`reject`) still refuses an ad-hoc row with the `unattributed` code, and the spec correctly pins that as preserved. The docs outcome must say what actually changes: ad-hoc rows become navigable, selectable, and inspectable; typed steering still refuses them, deferred to the attention-segment work.

6. **Doc scope misses a live mention.** The operator runbook's known-gotchas section describes unattributed workflows as one collapsed row per invocation — outside § Observe, so the current section-scoped AC leaves it stale. Include it in the documentation updates and in the corresponding acceptance outcome. Also add one clause distinguishing the deleted *segment* from the retained `unattributed` dock code, so the dock-code tables are visibly out of the deletion's blast radius.

### Cheap, required

7. **Node identity can change under a live group.** The representative run for a collapsed invocation is an active member while any member is active and the entry run once all terminate. This spec promotes that representative's id to the top-level node id and the scroll-follow key, so a selection can drop when a group's last active member finishes. One ledger line acknowledging the behavior (or ruling the alternative out) — it is currently unstated.

8. **Fix the test-strategy shorthand in the ledger.** "Never rendered ink" contradicts the spec's own task of updating an ink test that asserts over a stubbed element tree. The constraint is no real-terminal frame assertions; element-tree assertions with a stub `Text` are permitted and are how that test passes today.

9. **Name the active-status predicate choice.** The intent cites `isActiveRunStatus`; the tasks use the group-level rollup. State that the group rollup is the deliberate choice so the divergence is not read as an accident.

10. **Note the vestigial live-window filter.** The ledger asserts daemon `list` retention is the only cap; the unused 20-row live-window helper remains in the tree and stays documented as vestigial. One line placing its deletion out of scope prevents a future reader treating the claim as false.

11. **The pane-height derivation used by the overflow test is not an exported constant.** Say how the test derives the visible-row budget so the implementer does not invent an export.

### Rationale

Items 1–3 are completion blockers under the mutation-checkpoint and failing-test contracts: a hollow guard directive, an unparseable directive, or an unenumerated red test each strand the implement run at `blocked` rather than producing a bad merge. Items 4–6 are accuracy: acceptance criteria and docs that assert unchanged behavior which in fact changes rot the v1-behaviors parity baseline, which the spec guidance requires any behavior-changing spec to keep honest. Items 7–11 are one-line ledger and task clarifications that remove implementer guesswork at negligible cost.