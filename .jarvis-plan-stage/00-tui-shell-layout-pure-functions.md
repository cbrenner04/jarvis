# TUI shell layout pure functions

First slice of [tui-overhaul-brief.md](../tui-overhaul-brief.md). Pure geometry, column
degradation, and tree-cell truncation — no ink. Records the TUI-phase test strategy before layout
tests land.

## Problem

`jarvis tui` has no layout geometry or column-degradation logic; downstream shell work needs pure
`(columns, rows)` → region contracts and width → visible-column contracts first. Layout tests must
not assert painted ink output — CI cannot observe it (#2417/#2418).

## Decisions

- Layout regions from pure `(columns, rows, dividerOffset)` — rules out geometry read from a rendered ink tree.
- Default split 38/62; reference `245×72` at `dividerOffset: 0` yields left `94`, right `151`, pane height `68`, dock `4` — rules out recomputing reference sizes from ink layout.
- `dividerOffset` is session-local, not persisted — rules out cross-session divider state.
- Below `120` cols, layout mode is `stacked` (tree above detail, same dock) — rules out squeezing a side-by-side tree.
- `[`/`]` nudge is ±2 cols on `dividerOffset` with left floor `72` and left ceiling `40%` of width — rules out unclamped or persisted divider offsets.
- Column visibility is a pure function of left-pane width per [tui-overhaul-brief.md § Column degradation](../tui-overhaul-brief.md#column-degradation-left-pane-width); `state` and `elapsed` appear in every tier — rules out dropping elapsed before slice 3.
- Visible columns with no row value still occupy their defined width slots — rules out collapsing unpopulated cells.
- Tree cells truncate with `…` to exact column width via a pure formatter — rules out wrap or overflow in the tree grid.
- Module at `v2/src/tui/tui-shell-layout.ts` colocated with `tui-shell-layout.test.ts` — rules out a shared/ placement that would cross the v2 TUI seam.
- Rendered ink output assertions are unsupported for the TUI phase; prove layout/columns via pure functions, keybindings via injected input, behavior via monitor state — rules out CI ink-painting tests in this slice.
- Deferred to first consumer: stacked-mode pane width/height contracts beyond dock `4` and `layoutMode: "stacked"` — pin when the ink shell wires regions.

## Tasks

- Add `v2/src/tui/tui-shell-layout.ts` exporting pure layout helpers: region geometry from
  `(columns, rows, dividerOffset)`, divider nudge with clamps, visible tree columns from left-pane
  width, and tree-cell truncation.
- Add `v2/src/tui/tui-shell-layout.test.ts` pinning reference geometry, stacked fallback, nudge
  clamps, every degradation tier (`≥90`, `72–89`, `58–71`, `48–57`, `<48`), and cell truncation.
- Add guard-inversion comment checkpoints on the pinning tests naming source mutations for the
  stacked threshold, left floor, left ceiling, and `state`/`elapsed` retention guards.
- Add a `v2/docs/test-writing.md` section recording the TUI-phase test strategy and naming
  substitutes for rendered-output assertions (pure layout functions, injected input hook, production
  monitor state).
- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [ ] `tui-shell-layout.test.ts` — reference `245×72` geometry at default divider offset yields left `94`, right `151`, pane height `68`, dock `4`; fails against the pre-fix absent module.
- [ ] `tui-shell-layout.test.ts` — below `120` columns layout mode is `stacked` and dock height is `4`; fails against the pre-fix absent module.
- [ ] `tui-shell-layout.test.ts` — `[` cannot nudge left pane below `72` cols and `]` cannot nudge above `40%` of width; fails against the pre-fix absent module.
- [ ] `tui-shell-layout.test.ts` — column selection reproduces every brief degradation row (`≥90`, `72–89`, `58–71`, `48–57`, `<48`) with `state` and `elapsed` in all five; fails against the pre-fix absent module.
- [ ] `tui-shell-layout.test.ts` — tree-cell formatter truncates overflow to exactly the column width with `…`; fails against the pre-fix absent module.
- [ ] `tui-shell-layout.test.ts` — pinning tests include comment checkpoints naming guard-inversion mutations for the stacked threshold, left floor, left ceiling, and `state`/`elapsed` retention guards.
- [ ] Source-mutating each guard above (stacked threshold, left floor `72`, left ceiling `40%`, dropping `elapsed` from a tier) turns the corresponding pinning test RED. Do **not** add a production test flag. (Manual)
- [ ] `v2/docs/test-writing.md` records the TUI test-strategy decision and names substitutes for rendered-output assertions.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/test-writing.md` — TUI test strategy and what is not assertable.
