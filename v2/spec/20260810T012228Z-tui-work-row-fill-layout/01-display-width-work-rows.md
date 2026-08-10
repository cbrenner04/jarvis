# Compose display-width work rows

## Problem

- The fixed ten-column grid reserves empty cells, encodes widths twice, and truncates the identifying label before optional metadata.
- The existing width tiers do not describe a safe narrow-width floor or Unicode display-width behavior.

## Decisions

- Compose a `MonitorLineRow` as `indent · marker · fill label · right-aligned cluster`; indent is exactly `2 * depth` display columns, marker is one display column followed by one gap, cluster atoms are joined only when nonempty with one gap, and label padding consumes every remaining supported column.
- `MIN_LABEL_COLUMNS` is 4. For a row at depth `d` with compact status display width `S`, its supported width floor is `2 * d + 2 + 1 + S + MIN_LABEL_COLUMNS` (indent plus marker/gap, label/cluster gap, compact status, and label). Supported widths are every integer at or above that row-specific floor; no maximum applies.
- Below the floor, return one clipped, unpadded physical line using the same display-width primitive; it never wraps, but hierarchy, label, and compact-status retention are not guaranteed. All fill-label, right-edge, and compact-status guarantees apply only at or above the floor.
- Full clusters are ordered pipeline `definition, attention, elapsed`; branch `current stage, status, elapsed`; stage `status, elapsed`; run and ad-hoc `status, live, elapsed`. Ad-hoc rows use the run cluster and their existing entry-run branch label.
- A full cluster fits when its display width plus hierarchy, both inter-region gaps, and `MIN_LABEL_COLUMNS` fits the pane. Otherwise progressively drop the rightmost optional atom until a candidate fits, removing its adjacent separator: pipeline `elapsed`, `attention`, `definition`, then substitute pipeline status; branch `elapsed`, `current stage`, retaining status only; stage `elapsed`; run/ad-hoc `elapsed`, `live`. Empty atoms are skipped before fitting.
- Compact status is the row's status text, or `—` when status is empty; it is never combined with branch current stage. This intentionally resolves the floor to `indent · marker · fill label · status` for every kind.
- Labels ellipsize with `…` at grapheme boundaries and rows never wrap. Use the existing `Intl.Segmenter` grapheme segmentation and `Bun.stringWidth` display-width primitive for labels, spaces, wide characters, combining sequences, ZWJ sequences, and `▼`/`▶`/`✋`/`✗`.
- Delete `TREE_COLUMN_WIDTHS`, `visibleColumns`, the width-tier table, `listMonitorTreeCellsAtDepth`, `splitPrebuiltTreeRow`, their production references, and grid-specific tests. Tree-row builders return composed segments directly; no padded string is re-sliced.

## Tasks

- Replace the grid helpers with a pure display-width row composer and per-kind segment builders for every semantic display node.
- Implement the supported-width floor, full-cluster fit check, right-to-left atom degradation, compact-status substitution, fill padding, and below-floor clipping.
- Replace grid and tier assertions with pure composition, floor, degradation, Unicode-width, and one-line tests.
- Update `v2/docs/test-writing.md` § TUI test strategy with row-composition and cluster-degradation coverage instead of column degradation.

## Acceptance criteria

- [x] At each row's supported floor and above, pipeline, branch, stage, run, and ad-hoc rows occupy exactly one display line; the marker/label offset is `2 * depth + 2` for every reachable depth 0–3, the label ellipsizes with `…`, and the complete cluster ends at the right edge. `v2/src/tui/tui-shell-layout.test.ts` test `composes fill-width labels and per-kind clusters` fails against the fixed grid and passes after the change.
- [x] A full-cluster fixture whose width meets the fit condition renders every declared atom in order; one display column less drops exactly the rightmost optional atom, cleans its separator, keeps at least four label columns, and repeats that rule through compact status. Branch compact output contains status but not current stage; ad-hoc full and compact output follows the run order. `v2/src/tui/tui-shell-layout.test.ts` test `drops optional cluster atoms before shrinking the label` fails against the pre-fix tiers and passes after the change.
- [x] At one column below each derived floor the composer emits one clipped, unpadded line without wrapping; it does not claim fill-label, hierarchy, or status retention. At every supported width it measures and truncates wide characters, combining sequences, ZWJ sequences, and `▼`/`▶`/`✋`/`✗` by `Intl.Segmenter` graphemes and `Bun.stringWidth`, without splitting a grapheme or exceeding the pane width.
- [x] `TREE_COLUMN_WIDTHS`, `visibleColumns`, the width-tier table, `listMonitorTreeCellsAtDepth`, and `splitPrebuiltTreeRow` have no production references under `v2/src/`, and the tests covering the grid and tiers are removed.
- [x] `v2/src/tui/tui-shell-layout.test.ts` — `composes fill-width labels and per-kind clusters`; Keystone checkpoint: an in-body `// @mutate` restores the fixed-label baseline on the real production calculation and turns the scoped test red.
- [x] `v2/src/tui/tui-shell-layout.test.ts` — `drops optional cluster atoms before shrinking the label`; Mutation checkpoint: in-body `// @mutate` directives invert every added or modified fit, optional-atom, compact-status, floor, clipping, and grapheme-width guard on its real production condition, and linked negative cases prove each dropped atom remains absent while label width remains available.
- [x] `v2/src/tui/tui-shell-layout.test.ts` tests `run-row elapsed uses createdAt through finishedAtMs or nowMs`, `finishless terminal run elapsed keeps advancing when nowMs advances`, `a run row leads with its role and follows with the short run id`, and `a collapsed workflow row keeps its step context suffix after the role-first head` stay green.
- [x] `v2/docs/test-writing.md` § TUI test strategy replaces column-degradation guidance with pure row composition, derived-floor, grapheme-width, and cluster-degradation coverage.

## Documentation updates

- `v2/docs/test-writing.md` § TUI test strategy: pure row composition and cluster degradation replace column degradation.
