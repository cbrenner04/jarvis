---
name: tui-shell-layout-pure-functions
---

# TUI shell layout pure functions

First slice of [tui-overhaul-brief.md](../tui-overhaul-brief.md). Pure geometry, column
degradation, and tree-cell truncation — no ink. Records the TUI-phase test strategy before layout
tests land.

## Problem

`jarvis tui` has no layout geometry or column-degradation logic; downstream shell work needs pure
`(columns, rows)` → region contracts and width → visible-column contracts first. Layout tests must
not assert painted ink output — CI cannot observe it (#2417/#2418).

## Decisions

- Layout regions are computed by a pure function of `(columns, rows)` and session divider offset — rules out geometry read from a rendered ink tree.
- Reference `245×72` yields left `94`, right `151`, pane height `68`, dock `4`; default split `38/62`.
- `[`/`]` nudge is ±2 cols with left floor `72` and left ceiling `40%` of width — rules out unclamped or persisted divider offsets.
- Below `120` cols, layout is stacked (tree above detail, same dock) — rules out squeezing a side-by-side tree.
- Column visibility is a pure function of left-pane width per the brief degradation table; `state` and `elapsed` never drop; unpopulated columns reserve slots — rules out dropping elapsed before slice 3 or hiding columns without reserved width.
- Tree cells truncate with `…` to exact column width via a pure formatter — rules out wrap or overflow in the tree grid.
- Rendered ink output assertions are unsupported for the TUI phase; prove layout/columns via pure functions, keybindings via injected input, behavior via monitor state — rules out re-litigating per slice or adding CI ink-painting tests here.

## Acceptance criteria

- [ ] `tui-shell-layout.test.ts` — reference `245×72` geometry yields left `94`, right `151`, pane height `68`, dock `4`; fails against the pre-fix absent module.
- [ ] `tui-shell-layout.test.ts` — stacked layout below `120` columns keeps a `4`-line dock; fails against the pre-fix absent module.
- [ ] `tui-shell-layout.test.ts` — `[` cannot nudge left pane below `72` cols and `]` cannot nudge above `40%` of width; fails against the pre-fix absent module.
- [ ] `tui-shell-layout.test.ts` — column selection reproduces every brief degradation row (`≥90`, `72–89`, `58–71`, `48–57`, `<48`) with `state` and `elapsed` in all five; fails against the pre-fix absent module.
- [ ] `tui-shell-layout.test.ts` — tree-cell formatter truncates overflow to exactly the column width with `…`; fails against the pre-fix absent module.
- [ ] `v2/docs/test-writing.md` records the TUI test-strategy decision and names substitutes for rendered-output assertions.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/test-writing.md` — TUI test strategy and what is not assertable.

## Prerequisites

- `v2/spec/tui-overhaul-brief.md` documents region geometry and the column degradation table.
- TUI keybinding tests pin through the injected input hook without asserting painted ink frames (#2418).
