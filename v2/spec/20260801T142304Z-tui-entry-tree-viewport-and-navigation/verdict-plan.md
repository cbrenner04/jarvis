Validating key claims against the codebase before issuing the verdict.
## Verdict: refinements required

The spec targets the right seams (`currentState` dimensions vs ink paint, reversible pane-order walks, entry-layer `e` row-id parity). Prerequisites are satisfied. Before merge, the draft must close these gaps so implementers are not blocked on dimension wiring alone and acceptance criteria match observable pre-fix/post-fix behavior.

### 1. Navigation list stability must be an explicit work outcome

**Upheld.** Decision 3 binds reversible ↑/↓ walks, but Tasks only cover dimension injection, test edits, and docs. `selectNextRun` / `selectPreviousRun` already index `monitorSelectableNodeIds(currentState)`; the real failure mode is the selectable-id list reshaping when selection changes and effective expansion stops revealing ancestors — not a dedicated skip branch in `selectPreviousRun`.

**Required:** A task and acceptance outcome that ↑/↓ walks the same `monitorSelectableNodeIds` order in reverse without rows disappearing from under the cursor during the walk (under reveal-only expansion, without persistent `toggleExpansion` seeding).

### 2. Navigation pin contract must match intent and current code

**Upheld.** The existing `drives row navigation through the injected input hook` pin calls `toggleExpansion()` before walking (masking reveal-only collapse), ends on `run-orphan`, and only asserts one ↑ back to `run-matched` — which already passes pre-fix. Intent requires two ↑ from the attributed run leaf (`run-matched`) → stage → pipeline, reversing the ↓ path.

**Required:**
- Pin ends on `run-matched` (or equivalent attributed leaf), not `run-orphan`.
- Fixture exercises reveal-only expansion (no pre-walk `toggleExpansion` that masks list reshape).
- Assertions cover full reversible walk: ↓ path then two ↑ to stage then pipeline.
- AC wording reflects that the **extended** pin fails pre-fix, not the current single-assertion pin.
- Mutation AC reframed from “orphan→pipeline skip on `selectPreviousRun`” to “selection-driven list collapse during ↑ walk turns navigation pin RED.”

### 3. Stage `e` round-trip AC must use current failure rationale

**Upheld.** Prerequisite `20260801T134837Z-tui-pipeline-tree-reveal-ancestors-only` is merged; “fails pre-fix when reveal-on-select self-expand” is stale. The new pin still adds value: entry-layer left-pane tree row id round-trip on a **selected stage** with measured dimensions — not fully covered by flatten-layer or constituent-visibility pins.

**Required:**
- Drop stale self-expand pre-fix rationale.
- State actual pre-fix risks: missing stage `e` row-id round-trip at entry layer, or dimension mismatch on `currentState` during the round-trip.
- Add inverted-guard mutation AC for this pin (per spec guidance): short-circuiting stage `e` toggle or reintroducing selected-node self-expand in effective expansion turns the stage round-trip pin RED.

### 4. Preservation AC for existing terminal-size pins

**Upheld.** Moving dimensions onto `currentState` must not break `monitor state carries the injected terminal size` or `monitor state omits terminal size when the terminal reports none` (which assert shell-overlay behavior and absent-key semantics).

**Required:** Preservation AC that existing terminal-size pins in `tui-entry.test.tsx` stay green; task notes `terminalSize: () => ({})` must not synthesize dimension keys on `currentState`.

### 5. Dimension injection mechanism and path coverage

**Upheld.** “Every path that calls `monitorSelectableNodeIds`” is underspecified; natural fix is a shared wrapper (e.g. `withMeasuredTerminal`) on `setState` plus non-`setState` paths (`refreshRuns` initial assignment before `firstSelectableNodeId`, `updateConnections` selection validation).

**Required:**
- Decision/task names the wrapper (or equivalent single merge point) as the mechanism.
- Explicitly covers `refreshRuns` initial state and `updateConnections` validation, not only `setState` call sites.
- Clarifies `currentState` is authoritative for `monitorSelectableNodeIds`; `monitorShellState` re-applies the same `terminalSizeFn`, not a separate dimension source.

### 6. Documentation acceptance outcomes

**Upheld.** `operator-runbook.md` live-window paragraph contradicts reveal-ancestors-only (“a pipeline reveals its stages just to its own selection”) and defers full navigation to this spec. Docs ACs should also clarify that j/↓/↑ walk tree + unattributed rows only; queue rows are display-only.

**Required:**
- Docs task/AC explicitly fixes the “just to its own selection” sentence.
- Docs document real `e` toggle and pane-order j/↓/↑ behavior; remove ready-intent deferral and self-expand caveats.
- Docs note queue rows are not walk targets.

### 7. Alignment test — optional task hint only

**Partially upheld, not blocking.** The alignment AC is behavior-defined (every `monitorSelectableNodeIds(currentState)` id appears in left-pane tree row ids at the same terminal size, with more pipelines than fit). Optional task hint for small terminal + pipeline count above visible budget is acceptable; no AC change required.

### 8. Subspec shape — no split required

**Not upheld as oversized.** Dimension wiring, navigation stability, and docs share one module boundary (`tui-entry` navigation + dimension lifecycle) and one operator-facing behavior. Keep single subspec; separate Tasks explicitly so dimension and navigation streams are independently trackable during implementation.

### Rationale

These refinements align the spec with spec guidance: every runtime-behavior change needs a failing-test AC with accurate pre-fix claims; every added guard needs an inverted mutation AC; behavior-preserving tests need citation-style preservation ACs; tasks must cover all decisions, not only the easiest slice. Without them, an implementer can satisfy dimension injection and stall on navigation, or tick ACs whose “fails pre-fix” claims are false against current code.