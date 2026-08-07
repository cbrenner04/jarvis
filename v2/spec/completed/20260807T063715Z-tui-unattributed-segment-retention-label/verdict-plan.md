Reviewing the codebase to validate key architectural claims before issuing the verdict.
## Verdict: required refinements

### 1. Pin segment row budget and owning layer

The spec defers the unattributed segment row budget but requires FIFO overflow fixtures and production behavior under a budget. That leaves implementers able to satisfy acceptance criteria with a test-only cap disconnected from layout.

**Required outcome:** State where the budget is derived (layout/monitor-lines layer, not an arbitrary join default), which pane inputs subtract from available height (painted tree rows, unattributed heading, queue heading; queue body treatment consistent with slice 2), and that regression fixtures call the same budget function production uses.

**Rationale:** FIFO without a pinned budget is unfalsifiable; spec guidance requires failing-test ACs backed by reachable pre-fix behavior, not implement-time guesswork.

### 2. Name which function owns eviction

FIFO is assigned to the join path (replacing `filterMonitorRunsForLiveWindow`), but budget inputs live in `monitorLeftPaneTreeRows` / layout. The spec does not state whether join evicts with an injected budget, lines evicts post-join, or candidates and eviction are split across layers.

**Required outcome:** One explicit decision on eviction ownership and data flow between join and lines so the budget pin and FIFO task target the same seam.

**Rationale:** Architectural ambiguity at a shared seam is a merge conflict and wrong-layer implementation risk; refinement should close it before merge, not at wiring time.

### 3. Reconcile the windowing regression test

`excludes stage-matched and queued runs from unattributed while windowing orphans` mixes membership pins with one-hour-window retention (`run-stale-orphan` excluded). Replacing the live window with segment FIFO intentionally changes retention: stale orphans survive when under budget. The spec’s “preserve membership pins” task does not address this test.

**Required outcome:** Task explicit reconciliation—split membership vs retention expectations, or update retention expectations—so implementers are not blocked by green preservation tests that contradict FIFO intent.

**Rationale:** Behavior-changing specs must not silently rely on preservation of semantics the spec replaces; spec guidance distinguishes preservation ACs from new-behavior ACs.

### 4. Pin FIFO units and rollup semantics

Unattributed rows are workflow-collapsed (`buildWorkflowTableRows`). The legacy window path uses `workflowRollupFinishedAtMs` and `workflowGroupHasActiveMember`. The spec cites per-run `finishedAtMs` and active-never-dropped without stating whether FIFO operates on collapsed rows with the same rollup rules.

**Required outcome:** Decision that FIFO runs on post-collapse unattributed rows, with active retention and terminal eviction keyed to rollup finish/active semantics aligned to what the window filter used (minus the time cap).

**Rationale:** Without this, eviction order and active-never-dropped can disagree between grouped and raw runs; brief parity and the mutation checkpoint may pin the wrong guard.

### 5. Pin within-segment display sort order

Brief § Left pane FIFO specifies pane order: actives top by `createdAt`, terminals below by finish time oldest-first. The spec pins eviction (`oldest-by-finishedAtMs` first) but not retained-row display order; `buildWorkflowTableRows` preserves input order.

**Required outcome:** Decision aligning post-FIFO pane order with brief sort keys (same dimensions as eviction policy).

**Rationale:** Intent requires brief-consistent segment presentation; eviction-only pinning can ship wrong operator-visible ordering while tests pass on ids only.

### 6. Pin N=0 heading visibility and clarify “mirror Queue pattern”

Brief layout shows `─ Unattributed (0) ─`; Queue omits its heading when empty. Tasks say “mirror the Queue heading pattern” for ink wiring, which conflicts with brief parity at zero orphans.

**Required outcome:** Decision that the unattributed heading always renders as `─ Unattributed (N) ─` including `N = 0`; clarify that “mirror Queue” means ink segment wiring (heading before body), not Queue’s empty-segment omission.

**Rationale:** Label AC and operator docs need a single contract; mixed metaphors invite wrong empty-state behavior.

### 7. Name the label test surface and ink call path

Label AC targets `tui-monitor-lines.test.ts` but does not name the derivation export ink must call. `monitorTextLines` uses legacy paths; ink uses `monitorLeftPaneContentRows` → `monitorLeftPaneTreeRows` and renders unattributed rows without a heading today. Queue precedent tests `monitorLeftPaneQueueRows`, which ink calls directly.

**Required outcome:** Label AC and tasks name the helper or structured return under test (new export parallel to `monitorLeftPaneQueueRows`, or an extended tree-rows return) and require ink to call that same helper—without adding rendered-ink assertions.

**Rationale:** TUI test strategy avoids ink assertions but still requires tested derivation wired to paint; unnamed surface risks a green helper ink never invokes.

### 8. Tighten mutation checkpoint scope

The mutation AC targets inverting the active-retention guard only. That does not prove oldest-terminal-first eviction; a mis-aimed `@mutate` could satisfy the checkpoint while terminal ordering stays unguarded.

**Required outcome:** Mutation checkpoint must cover terminal eviction (invert oldest-first ordering or the terminal slice guard), via a stable unique anchor per spec guidance—either one directive on terminal eviction or linked directives covering both active retention and terminal ordering.

**Rationale:** Spec guidance requires guard inversion to turn the pinning regression red; active-only mutation under-proves the FIFO contract in the AC title.

### 9. Serial fan-out ordering on `tui-monitor-lines.ts`

Prerequisites allow landing “in parallel on `tui-monitor-lines.ts`” while `tui-remove-waitstate-window-detail` also edits that file. Spec guidance requires planning same-seam siblings serially; “disjoint from steering chain” describes feature coupling, not file-seam isolation.

**Required outcome:** Prerequisites require serial merge after `tui-remove-waitstate-window-detail` (capstone after wait-removal); remove parallel landing on `tui-monitor-lines.ts`.

**Rationale:** Parallel same-seam specs stale on first land; ready-intent fan-out already orders wait-removal before this capstone.

### 10. Align `intent.md` with subspec documentation scope

`intent.md` says mark slice 6 shipped unconditionally and lists only `tui-overhaul-brief.md`. The subspec correctly gates the shipped marker on all slice-6 siblings merging and adds `v1-behaviors.md` and `operator-runbook.md` for a behavior change.

**Required outcome:** `intent.md` matches subspec on gated slice-6 shipped wording and full documentation updates list (or states subspec supersedes intent for docs).

**Rationale:** Spec guidance requires `v1-behaviors.md` updates for behavior changes; stale intent misroutes plan review and implement doc scope.

### 11. Edge-case pins tied to budget formula

Finishless terminal orphans: legacy window keeps them (`terminalRunInLiveWindow(undefined) === true`). Spec does not state whether they count as active (never dropped) or terminal-with-unknown-finish. Zero budget when tree plus queue consume the pane: unattributed body row count is unstated.

**Required outcome:** Budget-formula decision covers zero-budget overflow and finishless-terminal classification so FIFO behavior is defined at the seams budget and eviction share.

**Rationale:** Undefined edge cases at budget boundaries produce inconsistent retention without testable contracts.

---

### Not required

**Subspec split.** FIFO, label, ink wiring, and docs are one operator-visible capstone (slice 6); heading `N` must reflect post-FIFO rows, and ink without tested derivation is hollow. Separate subspecs would not be independently shippable. Single subspec with dual regressions remains appropriate, matching slice 2’s tree-left-pane pattern.

**Rendered-ink acceptance criteria.** State derivation and production monitor paths are sufficient per TUI test strategy and intent; naming the ink call path (refinement 7) closes the integration gap without ink assertions.

**Queue FIFO scope.** Intent correctly excludes queue segment FIFO; optional brief-gap note in documentation updates is sufficient, not blocking.