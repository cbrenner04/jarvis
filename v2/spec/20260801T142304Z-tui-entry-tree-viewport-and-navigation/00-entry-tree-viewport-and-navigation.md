# Entry tree viewport and navigation

Entry derives selectable node ids from `currentState` without measured terminal size while ink paints
from `monitorShellState`, so `j`/↓ and ↑ can target unpainted rows and walk order is not reversible.

## Problem

`monitorSelectableNodeIds(currentState)` falls back to 245×72 because `currentState` never carries
measured terminal size; ink uses `monitorShellState` with real dimensions. On a small terminal with
many pipelines, entry offers more selectable ids than the pane paints. The navigation pin at
`tui-entry.test.tsx` seeds expansion with `toggleExpansion()` before walking and only asserts one ↑
from `run-orphan` — that passes pre-fix; reveal-only ↑ from `run-matched` collapses the selectable
list and skips stage and pipeline.

## Decisions

- `currentState` is authoritative for `monitorSelectableNodeIds`; measured `terminalColumns`/`terminalRows`
  land on `currentState` via a shared wrapper (e.g. `withMeasuredTerminal`) on `setState` plus
  `refreshRuns` initial assignment before `firstSelectableNodeId` and `updateConnections` selection
  validation — rules out shell-only injection via `monitorShellState` as the dimension source.
- `monitorShellState` re-applies the same `terminalSizeFn` for ink paint only; selectable ids and
  painted tree rows use the same dimensions on the state passed to `monitorLeftPaneTreeRows` — rules
  out entry fallback diverging from ink layout.
- `j`/↓ and ↑ walk `monitorSelectableNodeIds` in order without selection-driven list collapse
  removing rows from under the cursor during the walk (reveal-only expansion, no persistent
  `toggleExpansion` seeding) — rules out the pre-fix ↑ walk skipping stage and pipeline after
  `run-matched`.
- `terminalSize: () => ({})` must not synthesize dimension keys on `currentState`.
- No production `setInvert*ForTest` / `invert*ForTest` hooks — rules out test-only bypasses in entry
  navigation or dimension wiring.

## Prerequisites

- `20260801T134837Z-tui-pipeline-tree-reveal-ancestors-only` merged: reveal-on-select expands ancestors only; `expandedNodeIds` membership changes flatten output bidirectionally for a selected pipeline or stage.
- Three-deep `selectedNodeId` selection and `e` toggling `expandedPipelineNodeIds` on pipeline and stage rows wired in entry and ink (`tui-entry.test.tsx` expansion pins).

## Tasks

### Dimension wiring

- Add shared `withMeasuredTerminal` (or equivalent single merge point) on `setState`; also cover
  `refreshRuns` initial state before `firstSelectableNodeId` and `updateConnections` selection
  validation.
- Ensure `monitorShellState` re-applies the same `terminalSizeFn` without becoming a separate
  dimension source for `monitorSelectableNodeIds`.
- Add `tui-entry.test.tsx` `aligns selectable node ids with left-pane tree rows for the measured
  terminal size`: small terminal (e.g. 24 rows) with more pipelines than fit; every id from
  `monitorSelectableNodeIds(currentState)` appears in left-pane tree row ids for that size.
- Add `Mutation checkpoint:` on the alignment pin naming omitted terminal dimensions on `currentState`.

### Navigation list stability

- Keep `monitorSelectableNodeIds(currentState)` stable across ↑/↓ steps under reveal-only expansion
  so pane-order walks do not lose rows when selection changes.
- Update `tui-entry.test.tsx` `drives row navigation through the injected input hook`: reveal-only
  fixture (no pre-walk `toggleExpansion`); ↓ path ends on `run-matched`; two `selectPreviousRun`
  presses select that run's stage then its pipeline — reversing the ↓ path.
- Add `Mutation checkpoint:` on the navigation pin naming selection-driven list collapse during the ↑
  walk.

### Stage `e` row-id round-trip

- Add `tui-entry.test.tsx` `e on a selected stage returns left-pane tree row ids to their starting
  value after two presses`: selected stage with measured dimensions; two `e` presses round-trip
  left-pane tree row ids with a distinct intermediate list.
- Add `Mutation checkpoint:` on the stage round-trip pin naming short-circuited stage `e` toggle or
  selected-node self-expand in effective expansion.

### Docs

- Update `v2/docs/operator-runbook.md` `jarvis tui` row and live-window paragraph: remove ready-intent
  deferral and self-expand caveat; replace “a pipeline reveals its stages just to its own selection”;
  document real `e` toggle and `j`/↓/↑ pane-order walk (tree + unattributed rows only; queue rows
  display-only, not walk targets).
- Add `v2/docs/v1-behaviors.md` parity entry for pipeline-tree `e` toggle and reversible row
  navigation.

### Verification

- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [x] `tui-entry.test.tsx` — `e on a selected stage returns left-pane tree row ids to their starting
      value after two presses` fails against pre-fix entry (missing stage `e` row-id round-trip at
      entry layer or dimension mismatch on `currentState` during the round-trip) and passes after;
      two presses return the starting left-pane tree row id list with a distinct intermediate list.
- [x] `tui-entry.test.tsx` — short-circuiting stage `e` toggle or reintroducing selected-node
      self-expand in effective expansion turns `e on a selected stage returns left-pane tree row ids
      to their starting value after two presses` RED; `Mutation checkpoint:` on that pin names the
      inversion.
- [x] `tui-entry.test.tsx` — extended `drives row navigation through the injected input hook` fails
      against pre-fix (reveal-only fixture, no pre-walk `toggleExpansion`; ends on `run-matched`; two
      ↑ to stage then pipeline) and passes after.
- [ ] `tui-entry.test.tsx` — selection-driven list collapse during the ↑ walk turns `drives row
      navigation through the injected input hook` RED; `Mutation checkpoint:` on that pin names that
      collapse. (Manual) **Un-ticked at merge (operator):** reverting the collapse left all 216 tui tests
      green. With reveal now ancestors-only and `selectNextRun` persisting ancestors, the guard is
      unreachable in any state navigation can produce, so it was inert rather than pinned; the line
      was dropped from `monitorSelectableNodeIds`.
- [x] `tui-entry.test.tsx` — `aligns selectable node ids with left-pane tree rows for the measured
      terminal size` fails against pre-fix dimension fallback and passes after; every
      `monitorSelectableNodeIds(currentState)` id appears in left-pane tree row ids for the same
      terminal size.
- [ ] `tui-entry.test.tsx` — omitting measured terminal dimensions from `currentState` before
      `monitorSelectableNodeIds` turns `aligns selectable node ids with left-pane tree rows for the
      measured terminal size` RED; `Mutation checkpoint:` on that pin names that omission. (Manual)
      **Un-ticked at merge (operator):** reverting `setState`'s `withMeasuredTerminal` wrapper keeps
      all 216 tui tests green. Only the *initial draft* wiring is pinned. Entry's `currentState` is
      not observable through the view host — the shell re-measures via `monitorShellState` — so this
      mutation cannot be caught without a new seam. The wrapper is still required: the two
      clear-selection paths build fresh state objects and would otherwise drop the dimensions.
- [x] `tui-entry.test.tsx` — `monitor state carries the injected terminal size` and `monitor state
      omits terminal size when the terminal reports none` stay green.
- [x] `v2/docs/operator-runbook.md` — `jarvis tui` row and live-window paragraph document `e` toggle
      and `j`/↓/↑ pane-order navigation (tree + unattributed rows only; queue rows not walk targets);
      no ready-intent deferral, selected-node self-expand caveat, or “just to its own selection”
      sentence.
- [x] `v2/docs/v1-behaviors.md` — TUI pipeline-tree `e` and row-navigation parity entry added.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — `jarvis tui` row and live-window paragraph: real `e` and
  `j`/↓/↑ behavior; remove deferral/self-expand caveat and “just to its own selection”; note queue
  rows are display-only.
- `v2/docs/v1-behaviors.md` — pipeline-tree `e` toggle and reversible row-navigation parity entry.
