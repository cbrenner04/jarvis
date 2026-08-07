## Verdict: one required repair

### Required outcome 1 — the off-pane leg of `j, k, and off-pane selectNode keep the selected tree row in the painted viewport` (`v2/src/tui/tui-entry.test.tsx`) must actually exercise off-pane selection

The reorder silently hollowed this test, and it was not in the spec's blast-radius list. Its fixture (`overflowPipelineEntryDeps`) is 30 all-`succeeded` pipelines with `finishedAtMs` ascending by index, pane height 20. Under newest-finish-first, the painted window at offset 0 is `pipe-29 … pipe-10`, so the test's off-pane pick — `pipelines[maxVisibleRows]` (`pipe-20`) — now sits at flatten index 9, i.e. **on-pane**. The preceding forward/backward walk loops return the scroll offset to 0, so nothing rescues it: the final `selectNode` + `toContain` assertions pass trivially and scroll-follow-on-off-pane-selection is no longer covered.

Required:

- The pipeline selected in that leg must be off-pane under the post-change order (a low-index fixture element, e.g. `pipelines[0]`, is off-pane at offset 0).
- The test must assert that the chosen row is **not** in the painted tree rows before `selectNode`, so the leg cannot go vacuous again on a future reorder. This mirrors the repair already made to the sibling test `resolves pipeline detail for off-pane tree row selection` in `v2/src/tui/tui-monitor-lines.test.ts`, which carries exactly that guard.

Rationale: the subspec's preservation criterion claims "off-pane reachability" assertions stay green *because* the reorder changes where rows paint, not which rows exist. That claim is only honest if the off-pane fixtures are re-derived under the new order — which the spec did for the `tui-monitor-lines.ts` twin and missed for the identical idiom in the entry suite.

### Required outcome 2 — `v2/spec/tui-command-center-brief.md` must not still attribute the shipped ordering to the queued seed

Row 2 of the tracker table was updated, but the § Design bullet for **Unified work tree** still lists "Order: running → awaiting gate → terminal (newest finish first)" as a deliverable of that not-yet-implemented seed. The point of the seed-prune task was single ownership of this decision; leave a one-word shipped marker (or a pointer to this subspec) so a future implementer of `tui-unified-work-tree` doesn't re-derive it.

### Explicitly not required

- **Terminality read from `state` rather than `finishedAtMs !== null`.** The decision ledger rules out finish-stamp classification by name, and `tui-monitor-lines.ts` already classifies terminality from a closed state set (`countActivePipelines` treats an unrecognized state as active). The change removes a classifier split rather than creating one. No hybrid predicate.
- **A `pending`-state fixture.** The spec pins the running/gated fixture to a literal set; the superseded test carried no `pending` coverage, so nothing was dropped. Adding one is scope creep.
- **Exporting the comparator or restoring the seed's ad-hoc "any live/active member" running definition.** Both are deferred-to-first-consumer by the ledger; the seed's replacement line already records the open `rank`-key question.
- **Re-wrapping the new `v1-behaviors.md` prose.** One physical line per bullet is the repo rule; the surrounding ~90-col wrapping is legacy.

Optional polish, take or leave: in the `v1-behaviors.md` unattributed-segment bullet, the inserted inconsistency note sits between the FIFO description and "…without that cap," stretching that antecedent; moving the note to the end of the bullet restores it.