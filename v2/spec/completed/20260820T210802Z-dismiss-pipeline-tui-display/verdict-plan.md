## Verdict — refine before implementation

The design and split (two subspecs) are sound; the intent is not in question. Fourteen items must be addressed. Nothing requires a further split of the filtering work — the tree filter, attention filter, and attributed-run suppression share one predicate and one options type, and diff size is far under the reviewability warning.

### Structural

1. **Move the `(dismissed)` row marker out of `00` and into `01`** — its task line, both marker acceptance criteria, its `@mutate` directive, and its documentation sentence. The marker is orthogonal to filtering, unreachable by any operator until the toggle exists, and `00` currently writes a `v1-behaviors.md` entry describing a marker nothing at that commit can produce, which corrupts the parity baseline mid-stack. Every original task and acceptance outcome must survive exactly once across the two subspecs after the move; `00`'s documentation entry must drop the marker sentence and `01`'s must gain it.

### Correctness / implementability blockers

2. **`01` breaks an existing, unnamed test.** `pipelineList()` is declared argument-less (`v2/src/tui/tui-daemon-client.ts:42`, forwarded at `:122` with no params), and `tui-daemon-client.test.ts:487` calls it argument-less and asserts the exact request frame with no `params` key. `01` names neither the file nor the breakage. The spec must decide compatibility explicitly — a parameter shape that leaves the existing frame test green and unmodified, with the ledger's real decision (the TUI always sends an explicit boolean) preserved at the call site — and must state that decision rather than leave it to the implementer. This also removes the fragility of a keystone revert whose type-validity depends on the parameter being optional.

3. **`01` has no wire-level acceptance criterion.** Add one asserting the opt-in request frame actually carries `includeDismissed` — the daemon reads `params?.includeDismissed === true`, so the frame is the contract.

4. **A missing `dismissedAt` must not read as dismissed.** `parsePipelineList` (`tui-daemon-client.ts:73-79`) validates only that `pipelines` is an array, then blind-casts. A `dismissedAt !== null` predicate treats `undefined` as dismissed, so a daemon running a pre-`dismiss-pipeline-durable-flag` binary loses *every* pipeline from tree, attention, and dock — silent, total blanking, reachable because daemons outlive binary upgrades. The spec needs a ledger decision that only a numeric timestamp counts as dismissed, plus an acceptance criterion pinning a snapshot with the field absent as visible.

5. **`00`'s implementer note contradicts its own ledger.** It says the attention projection's incident builder passes the options through to the tree join *and* that the join stays unfiltered there. Those readings rule out different failure modes (only the filtered reading reaches the fall-through-to-branch-label case the ledger describes). Pick one and state it once.

6. **`01`'s toggle-off criterion passes vacuously.** Toggling off issues a *succeeding* default request that overwrites the retained snapshots wholesale, so the projection filter is never exercised and the criterion cannot distinguish the fix from a no-op. Restate it so the off-path genuinely exercises client-side filtering over retained dismissed snapshots (a failing off-refresh, or asserting the paint before the refresh resolves).

7. **The `collectMatchedInvocationIds` mutation is order-fragile.** If the filtered-snapshot binding is declared below that call site, the mutation is a temporal-dead-zone throw and the test goes red for the wrong reason — proving nothing. Pin the declaration order (or choose an anchor that cannot degrade this way).

8. **The dock's displayed-snapshot helper is an uncheckpointed new guard.** It carries its own `showDismissed` read, and the last-good-snapshot criterion asserts dock counts change off it. It needs its own mutation directive. (The attention-side snapshot filter is already covered — it calls the same predicate the keystone inverts.)

9. **`01` must not instruct the runbook to point at a command that does not exist here.** `jarvis pipeline dismiss` is unimplemented at this spec's commit and `index.md` declares no CLI change lands. Phrase the operator documentation so it is true at this commit.

### Doc-anchor collisions (both specs will strand otherwise)

10. **The stale `dismiss-pipeline-*` ready-intent note (`operator-runbook.md:678`) is claimed by both this spec and the already-merged-but-unimplemented `dismiss-pipeline-cli` spec**, which asserts by its own acceptance criteria that it replaces that note. `01` should drop that replacement and own only the `jarvis tui` sentences describing the `D` toggle.

11. **`v1-behaviors.md:243` is also claimed by both** — the CLI spec amends the same dismissed-exclusion entry to name `--all`. `01`'s amendment must be scoped to the TUI clause and phrased so it holds whether or not the CLI amendment landed first; it must not assume the entry still reads "none of them pass `includeDismissed` yet."

### Undecided behavior that needs a ledger line

12. **Marker scope with the toggle on.** Attention rows derive their label from a shared helper the spec deliberately does not touch, so with dismissed shown, a dismissed pipeline's attention rows look identical to live work *and* its awaiting gate re-enters the six-row attention cap, able to push live incidents into overflow with no cue. The ledger currently frames this as helper hygiene and never states the consequence. Decide explicitly: mark attention rows too, or accept unmarked rows as a deliberately temporary inspection mode. Silence is the defect.

13. **Toggle during an in-flight refresh.** `refreshRuns` coalesces concurrent calls into a queued re-run, so the opt-in request goes out on the queued loop rather than synchronously — correct, but unstated, and the "refreshes on the spot" criterion currently implies a synchronous request. State the coalescing behavior and word the criterion as "without waiting for a scheduler tick."

14. **Dismissal hides an awaiting gate; it does not abandon it.** Since both subspecs ship in one PR, `D` always restores actionability — say so in one ledger line. Whether dismissing *should* abandon a gate is a product question above this surface and belongs in a seed, not here.

### Prose accuracy

15. `00`'s Problem overstates last-good retention as a persistent condition. Retention happens only when the `pipeline_list` call throws; a vanished socket is evicted first, and a healthy tick overwrites wholesale — so on a same-version healthy daemon, dismissal does self-heal. Restate the motivation as the retention window during transient daemon failure plus the show-dismissed toggle transition, and note that client-side filtering is the intent's decision, not this spec's to relitigate. The decision stands; only the prose is wrong.

16. `00`'s "every state-reading call site" leaves the implementer to derive roughly ten sites across two files. Name them or state the rule sharply enough to be mechanical.

17. Minor fixes: the ink-monitor criterion should say the command-focused `D` invokes no *tree* control (text insertion is itself a control); `steeringFeedback: null` in the suggested control body needs a ledger line or removal; the note's claim that fixtures default `dismissedAt` does not hold for the entry test suite, which uses inline literals; and the command-focus guard's position relative to the neighboring key branch is stated incorrectly.

### Rejected

- A three-way split of `00`'s filtering work — the pieces share one predicate and one new signature; splitting would force the second subspec to immediately reopen the first's surface.
- The claim that threading the flag breaks steering. Every consumer is selection-keyed and the existing selectable-id reconciliation clears a selection whose node disappears. This warrants one ledger line naming the narrow flip-to-refresh window, not a redesign.