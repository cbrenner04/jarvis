Reviewing the implementation and tests against the spec to issue a verdict.
## Verdict: refinements required

### 1. Alignment pin must force viewport overflow

The alignment acceptance criterion describes a small terminal with more pipelines than the pane can show. The current twelve-pipeline fixture at 80×24 (~20 tree rows after the dock) likely fits without FIFO trimming, so dimension-driven divergence between navigation and paint may never surface.

**Required:** The alignment fixture must exceed the left-pane row budget at the injected terminal size so trimming or equivalent overflow behavior is in play—the stress case the spec problem statement describes.

### 2. Alignment pin must guard entry-layer dimensions, not shell-state parity alone

The spec’s dimension decision is that `currentState` carries measured `terminalColumns`/`terminalRows` before `monitorSelectableNodeIds` on navigation paths. Pre-fix, `currentState` fell back to 245×72 while ink painted from measured shell state.

The alignment pin compares `monitorSelectableNodeIds` and painted row ids on `view.monitorStates`, which already received dimensions via `monitorShellState`. That static shell snapshot comparison would likely pass pre-fix and does not exercise the operational bug (`selectNextRun` / `selectPreviousRun` indexing `monitorSelectableNodeIds(currentState)`).

**Required:** The pin must fail when measured dimensions are absent from the state entry navigation uses—e.g. pane-order walk under overflow asserting each navigation target appears in painted row ids at the measured size, or an equivalent entry-layer assertion. Shell-only consistency on the last rendered snapshot is insufficient for the AC’s “fails against pre-fix dimension fallback” claim.

### 3. Alignment mutation checkpoint must match what the pin actually detects

The checkpoint comment targets omitting measured dimensions on `currentState` before `monitorSelectableNodeIds`. Reverting `withMeasuredTerminal` on `setState` alone would not turn the current pin RED because it never observes raw `currentState`.

**Required:** After strengthening the pin (outcomes 1–2), the mutation checkpoint must name an inversion that actually fails the test—dimension omission on the navigation path—or the checkpoint text must be rewritten to match the pin’s real guard. Checkpoint and test must agree.

### 4. Operator-runbook wording (docs)

The live-window paragraph says navigation walks “visible tree rows,” but when FIFO cannot drop further terminal pipelines, pane-order tree rows can extend beyond the viewport while selectable and painted lists stay aligned.

**Required:** Replace “visible tree rows” with accurate pane-order language (rows in the left-pane tree list, which may extend past the viewport when trimming stops). Optional but worthwhile: one clause that ↓ session expand writes the same `expandedPipelineNodeIds` store as `e`.

---

### Rationale

Core behavioral outcomes (reversible ↑/↓, `withMeasuredTerminal` on operational paths, stage `e` round-trip, navigation list stability via `selectedNodeId: null` in `monitorSelectableNodeIds`, main docs ACs) are implemented. Merge is blocked only on verification honesty: the alignment AC and its mutation checkpoint are ticked but do not reliably detect the dimension regression they claim to guard. Strengthening the alignment pin closes that gap without changing the spec’s required behavior.

**Not required for this pass:** terminal resize handling, `intent.md` checkbox sync, navigation-under-overflow as a separate pin beyond the strengthened alignment test, `selectNextRun` double-`setState` batching, or `pipelineNodesForState` deduplication—these are pre-existing edges, performance nits, or follow-up hardening outside stated acceptance criteria.