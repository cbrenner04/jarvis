# Tree row grid formatter

Pure fixed-width tree rows for monitor run lines — first consumer of `visibleColumns` and
`formatTreeCell` before the ink shell paints them.

## Problem

Run rows are space-separated segments (`tui-monitor-lines.ts`). The command-center brief needs a
fixed-width column grid with truncation and empty-slot reservation; ink wiring is the next subspec.

## Decisions

- Column widths match [tui-overhaul-brief.md § Left pane — tree columns](../tui-overhaul-brief.md#left-pane--tree-columns) reference table — rules out ad-hoc per-row spacing.
- `visibleColumns(leftPaneWidth)` selects which columns render; dropped columns are omitted, not squeezed — rules out reflowing remaining columns into dropped widths.
- Unpopulated cells still emit a width-padded empty field (spaces to column width) — rules out collapsing absent values into neighbors.
- Slice-1 run mapping: `marker` selection `>`/space; `indent` two spaces for workflow-child rows, empty slot otherwise; `label` run id (workflow role suffix appended in label when present); `project`, `branch`, `state` from existing row fields; `elapsed` slot reserved but empty (elapsed values out of scope); `live` from liveness text; `agent` and `id` short-id slots reserved but empty — rules out inventing elapsed/agent/id values here.
- Row string is the concatenation of formatted visible cells only; no trailing separator — rules out reusing `joinMonitorRow` segment spacing.
- Export a pure `buildMonitorTreeRow` (name need not be exact) from `tui-shell-layout.ts` or a colocated module imported only from layout tests and ink shell — rules out formatting inside ink components untested at the pure layer.
- Tests assert formatted strings, not painted ink — rules out rendered-frame assertions ([#2417](https://github.com/cbrenner04/jarvis/issues/2417), [#2418](https://github.com/cbrenner04/jarvis/issues/2418)).

## Tasks

- Add reference column-width map and a pure row builder that, given a workflow table row snapshot,
  selected-run id, and left-pane width, returns one fixed-width line string using `visibleColumns` and
  `formatTreeCell`.
- Extend `tui-shell-layout.test.ts` with overflow truncation, empty-slot width, and degradation-tier
  cases (at minimum: full width drops nothing; a `72–89` width drops `agent`/`id` while `state` and
  `elapsed` remain).
- Add guard-inversion comment checkpoints on the overflow and empty-slot pins naming the mutations
  below.
- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [ ] `tui-shell-layout.test.ts` — tree row builder applies `formatTreeCell` so overflow truncates with `…` at column width; fails against the pre-fix absent builder.
- [ ] `tui-shell-layout.test.ts` — unpopulated column slots consume their defined widths (empty project cell on a child row still advances the grid); fails against the pre-fix absent builder.
- [ ] `tui-shell-layout.test.ts` — the overflow pin test includes a comment checkpoint naming the required guard-inversion mutation (skip or bypass `formatTreeCell` on overflow).
- [ ] `tui-shell-layout.test.ts` — the empty-slot pin test includes a comment checkpoint naming the required guard-inversion mutation (omit width padding for absent cell values).
- [ ] Source-mutating each checkpointed guard above turns the matching pin RED. Do **not** add a production test flag. (Manual)
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

None — pure formatter; operator-visible shell behavior is documented in subspec 01.
