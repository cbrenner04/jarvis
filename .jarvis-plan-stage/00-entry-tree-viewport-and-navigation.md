# Entry tree viewport and navigation

Entry derives selectable node ids from `currentState` without measured terminal size while ink paints
from `monitorShellState`, so `j`/↓ and ↑ can target unpainted rows and walk order is not reversible.

## Problem

`monitorSelectableNodeIds(currentState)` falls back to 245×72 because `currentState` never carries
measured terminal size; ink uses `monitorShellState` with real dimensions. On a small terminal with
many pipelines, entry offers more selectable ids than the pane paints. The navigation pin at
`tui-entry.test.tsx` encodes skipping the stage and run walked through on ↑.

## Decisions

- `currentState` carries measured `terminalColumns`/`terminalRows` before any `monitorSelectableNodeIds` call — rules out shell-only injection via `monitorShellState`.
- Selectable ids and painted tree rows use the same dimensions on the state passed to `monitorLeftPaneTreeRows` — rules out entry fallback diverging from ink layout.
- `j`/↓ and ↑ walk `monitorSelectableNodeIds` in order without deselect collapsing rows out from under the cursor — rules out the current orphan→pipeline skip on `selectPreviousRun`.
- No production `setInvert*ForTest` / `invert*ForTest` hooks — rules out test-only bypasses in entry navigation or dimension wiring.

## Prerequisites

- `20260801T134837Z-tui-pipeline-tree-reveal-ancestors-only` merged: reveal-on-select expands ancestors only; `expandedNodeIds` membership changes flatten output bidirectionally for a selected pipeline or stage.
- Three-deep `selectedNodeId` selection and `e` toggling `expandedPipelineNodeIds` on pipeline and stage rows wired in entry and ink (`tui-entry.test.tsx` expansion pins).

## Tasks

- Inject measured terminal dimensions into `currentState` on every path that calls
  `monitorSelectableNodeIds` or `firstSelectableNodeId` before ink-only `monitorShellState` would
  diverge (`setState`, `refreshRuns`, selection validation, `openMonitor` controls).
- Add `tui-entry.test.tsx` `aligns selectable node ids with left-pane tree rows for the measured
  terminal size`: small-terminal fixture with more pipelines than fit; every id from
  `monitorSelectableNodeIds(currentState)` appears in left-pane tree row ids for that size.
- Add `tui-entry.test.tsx` `e on a selected stage returns left-pane tree row ids to their starting
  value after two presses`: selected stage, two `e` presses round-trip left-pane tree row ids with a
  distinct intermediate list.
- Update `tui-entry.test.tsx` `drives row navigation through the injected input hook`: from a run
  leaf, two `selectPreviousRun` presses select that run's stage then its pipeline — the same nodes
  `selectNextRun` traversed, in reverse.
- Add `Mutation checkpoint:` comments on the three pins naming omitted terminal dimensions on
  `currentState` or non-reversible `selectPreviousRun` walk order.
- Update `v2/docs/operator-runbook.md` `jarvis tui` row and live-window paragraph: remove
  ready-intent deferral and self-expand caveat; document real `e` toggle and `j`/↓/↑ row walk in pane
  order.
- Add `v2/docs/v1-behaviors.md` parity entry for pipeline-tree `e` toggle and reversible row
  navigation.
- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [ ] `tui-entry.test.tsx` — `e on a selected stage returns left-pane tree row ids to their starting
      value after two presses` fails against pre-fix entry (reveal-on-select self-expand or missing
      stage `e` round-trip) and passes after; two presses return the starting left-pane tree row id
      list with a distinct intermediate list.
- [ ] `tui-entry.test.tsx` — `drives row navigation through the injected input hook` fails against
      pre-fix non-reversible walk and passes after; from a run leaf, two `selectPreviousRun` presses
      select that run's stage then its pipeline.
- [ ] `tui-entry.test.tsx` — `aligns selectable node ids with left-pane tree rows for the measured
      terminal size` fails against pre-fix dimension fallback and passes after; every
      `monitorSelectableNodeIds(currentState)` id appears in left-pane tree row ids for the same
      terminal size.
- [ ] `tui-entry.test.tsx` — omitting measured terminal dimensions from `currentState` before
      `monitorSelectableNodeIds` turns `aligns selectable node ids with left-pane tree rows for the
      measured terminal size` RED; `Mutation checkpoint:` on that pin names that omission.
- [ ] `tui-entry.test.tsx` — restoring orphan→pipeline skip on `selectPreviousRun` turns `drives row
      navigation through the injected input hook` RED; `Mutation checkpoint:` on that pin names that
      skip.
- [ ] `v2/docs/operator-runbook.md` — `jarvis tui` row and live-window paragraph document `e` toggle
      and `j`/↓/↑ pane-order navigation; no ready-intent deferral or selected-node self-expand caveat.
- [ ] `v2/docs/v1-behaviors.md` — TUI pipeline-tree `e` and row-navigation parity entry added.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — `jarvis tui` row and live-window paragraph: real `e` and
  `j`/↓/↑ behavior; remove deferral/self-expand caveat.
- `v2/docs/v1-behaviors.md` — pipeline-tree `e` toggle and reversible row-navigation parity entry.
