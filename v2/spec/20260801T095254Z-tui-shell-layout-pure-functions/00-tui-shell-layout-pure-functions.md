# TUI shell layout pure functions

First slice of [tui-overhaul-brief.md](../tui-overhaul-brief.md). Pure geometry, column
degradation, and tree-cell truncation — no ink. Records the TUI-phase test strategy before layout
tests land.

## Problem

`jarvis tui` has no layout geometry or column-degradation logic; downstream shell work needs pure
`(columns, rows)` → region contracts and width → visible-column contracts first. Layout tests must
not assert painted ink output — CI cannot observe it (#2417/#2418).

## Prerequisites

- `v2/spec/tui-overhaul-brief.md` documents region geometry and the column degradation table.
- TUI keybinding tests pin through the injected input hook without asserting painted ink frames (#2418).

## Decisions

- Layout regions from pure `(columns, rows, dividerOffset)` — rules out geometry read from a rendered ink tree.
- Default split 38/62: `baseLeft = ceil(columns × 0.38)`; `left = baseLeft + dividerOffset`; clamp `left` to floor `72` and ceiling `floor(columns × 0.40)`; `right = columns − left`; `paneHeight = rows − 4`; `dockHeight = 4`. Reference `245×72` at `dividerOffset: 0` yields left `94`, right `151`, pane height `68`, dock `4` — rules out recomputing reference sizes from ink layout.
- `dividerOffset` is session-local, not persisted — rules out cross-session divider state.
- `layoutMode`: below `120` cols → `stacked` (tree above detail, same dock); at `≥120` cols → `split` (side-by-side tree and detail) — rules out squeezing a side-by-side tree or divergent mode names.
- `[`/`]` nudge is ±2 cols on `dividerOffset` with left floor `72` and left ceiling `40%` of width — rules out unclamped or persisted divider offsets.
- `visibleColumns(leftPaneWidth)` is defined only for `split` layout; stacked mode does not call it until the ink shell pins stacked tree width — degradation tests remain side-by-side only.
- Column visibility is a pure function of left-pane width per [tui-overhaul-brief.md § Column degradation](../tui-overhaul-brief.md#column-degradation-left-pane-width); per-tier visible column id lists and order match the brief table — rules out subset or reorder drift.
- Unpopulated column slot reservation (empty cells consume defined widths) is deferred to the ink-shell sibling — pin when the shell wires row formatting; rules out untestable fixed-grid claims in this slice.
- Tree cells truncate with `…` to exact column width via a pure formatter; width is measured in code units (repo convention), not terminal display width — rules out wrap or overflow in the tree grid.
- Module at `v2/src/tui/tui-shell-layout.ts` colocated with `tui-shell-layout.test.ts` — rules out a shared/ placement that would cross the v2 TUI seam.
- Rendered ink output assertions are unsupported for the TUI phase; prove layout/columns via pure functions, keybindings via injected input, behavior via monitor state — rules out CI ink-painting tests in this slice.
- Deferred to first consumer: stacked-mode pane width/height contracts beyond dock `4` and `layoutMode: "stacked"` — pin when the ink shell wires regions.

## Tasks

- Add `v2/src/tui/tui-shell-layout.ts` exporting pure layout helpers: region geometry from
  `(columns, rows, dividerOffset)` per the 38/62 ceil-and-clamp rules above, divider nudge with
  clamps, `visibleColumns` from left-pane width (`split` only), and tree-cell truncation (code-unit width).
- Add `v2/src/tui/tui-shell-layout.test.ts` pinning reference and non-reference geometry, `120`-col
  boundary (`119` → `stacked`, `120` → `split`), nudge clamps, every degradation tier with full column-id
  lists and boundary widths (`90`/`89`, `72`/`71`, `58`/`57`, `48`/`47`), and cell truncation (overflow
  and exact-fit).
- Add guard-inversion comment checkpoints on the pinning tests naming source mutations for the
  stacked threshold, left floor, left ceiling, and tier-boundary guards.
- Add a `v2/docs/test-writing.md` section recording the TUI-phase test strategy: CI cannot observe
  painted ink (#2417/#2418) and rendered-frame assertions risk local-green/CI-red asymmetry; name
  substitutes (pure layout functions, injected input hook, production monitor state); cross-link
  [operator-runbook.md § Gate trust](../operator-runbook.md#gate-trust); note full runbook wording
  updates are owned by the ink-shell sibling.
- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [x] `tui-shell-layout.test.ts` — reference `245×72` geometry at `dividerOffset: 0` yields left `94`, right `151`, pane height `68`, dock `4`; fails against the pre-fix absent module.
- [x] `tui-shell-layout.test.ts` — non-reference geometry (e.g. `200×50` at `dividerOffset: 0`) yields left `76`, right `124`, pane height `46`, dock `4` per `ceil(columns × 0.38)`; fails against the pre-fix absent module.
- [x] `tui-shell-layout.test.ts` — width `119` → `layoutMode: "stacked"` with dock height `4`; width `120` → `layoutMode: "split"`; fails against the pre-fix absent module.
- [x] `tui-shell-layout.test.ts` — `[` cannot nudge left pane below `72` cols and `]` cannot nudge above `40%` of width; fails against the pre-fix absent module.
- [x] `tui-shell-layout.test.ts` — `visibleColumns` at width `≥90` returns `marker`, `indent`, `label`, `project`, `branch`, `state`, `elapsed`, `live`, `agent`, `id` in order; at `72–89` drops `agent` and `id`; at `58–71` drops `branch`; at `48–57` drops `project`; at `<48` returns `marker`, `label`, `state`, `elapsed` only; boundary pins at `90`/`89`, `72`/`71`, `58`/`57`, and `48`/`47` fail on off-by-one tier bugs; fails against the pre-fix absent module.
- [x] `tui-shell-layout.test.ts` — tree-cell formatter truncates overflow to exactly the column width with `…` and leaves exact-fit text unchanged (no ellipsis); width measured in code units; fails against the pre-fix absent module.
- [x] `tui-shell-layout.test.ts` — pinning tests include comment checkpoints naming guard-inversion mutations for the stacked threshold, left floor, left ceiling, and tier-boundary guards.
- [ ] Source-mutating each guard above (stacked threshold, left floor `72`, left ceiling `40%`, tier boundary) turns the corresponding pinning test RED. Do **not** add a production test flag. (Manual)
- [x] `v2/docs/test-writing.md` records that CI cannot observe painted ink (#2417/#2418) and rendered-frame assertions risk local-green/CI-red asymmetry; names substitutes for rendered-output assertions; cross-links [operator-runbook.md § Gate trust](../operator-runbook.md#gate-trust); notes ink-shell sibling owns full runbook wording updates.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/test-writing.md` — TUI test strategy, CI ink observability limits, and what is not assertable.
