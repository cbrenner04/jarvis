# 00 - Color status and liveness cells

`jarvis tui` renders every monitor line as one flat `Text` (`monitorTextLines` in
`v2/src/tui/tui-monitor-lines.ts`, rendered by `v2/src/tui/tui-ink-monitor.tsx`), so a run's
status and liveness read the same as its runId. Split those two cells out and color them by
run-state semantics, keeping the text labels.

## Decisions

- `monitorTextLines` becomes a join over a new segment model in the same module; rejected a
  parallel structured builder, which would make the text and ink paths two sources of truth.
- Segments carry a semantic tone (`active` / `success` / `failure`), not an ink color; the ink
  monitor maps tone → color. Rejected embedding color names in the line builder, which would
  couple the pure module to ink.
- Separators are segments: the single spaces that today's join produces are emitted explicitly as
  untoned segments, so sibling `Text` cells reproduce today's spacing. Rejected letting ink lay out
  cells, which drops the join's whitespace and misaligns the table.
- Tone map is a total record over `RunStatus` (no default arm), so a new run status fails typecheck
  rather than rendering uncolored.
- `completed` → success; `failed`, `killed`, `blocked`, `budget-soft-stopped` → failure;
  `in-progress`, `paused`, `queued`, `awaiting-human`, `revising` → active. The split is
  terminality: `blocked` and `budget-soft-stopped` have stopped and will not resume from this
  screen, which groups them with `failed`/`killed`; `awaiting-human` is a live run pausing for
  input the TUI itself accepts, so it stays active.
- Palette (pinned now — the ink monitor is the first consumer): active `cyan`, success `green`,
  failure `red`.
- `live` takes the active tone; `not-live` is uncolored — it is a liveness fact, not a terminal
  outcome.
- The composing `Revise prompt:` line becomes an untoned single-segment row the ink monitor appends
  to the segment rows; rejected keeping it as a raw string appended after the builder, which would
  leave a second rendering path at the exact seam the segment model exists to close.
- Outcome panel `runStatus:` stays uncolored: it is key/value diagnostics, not the at-a-glance state
  table. Row markers, headers, queue admission descriptor, workflow lines, and steering feedback
  also stay uncolored.

## Task checklist

- [ ] Add a segment model (text + optional tone, separators included) and a total tone map to
      `v2/src/tui/tui-monitor-lines.ts`; keep `monitorTextLines` as the joined-text view over it.
- [ ] Render run-table and queue rows in `tui-ink-monitor.tsx` as sibling `Text` cells, coloring
      only toned segments; append the composing line as an untoned segment row.
- [ ] Unit-test the tone map over every member of `RUN_STATUSES` and both liveness values.
- [ ] Add a render-level test (`tui-ink-monitor.test.tsx`) driving `openInkMonitor` through the
      `loadInkUi(inkRender)` fake-renderer seam, asserting the `color` prop on status and liveness
      cells.
- [ ] Pin full `monitorTextLines` output for a fixture state in `tui-monitor-lines.test.ts`.
- [ ] Update `v2/docs/first-workflow-walkthrough.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [x] Each run-table row renders `status` and `liveness` as distinct ink `Text` cells; every other
      cell in the row keeps its current text and no color.
- [x] Status text is unchanged from today and always rendered — color is additive, never the only
      state signal.
- [x] A render-level test over the fake `inkRender` seam asserts `color` on the status and liveness
      cells: `completed` green; `failed`, `killed`, `blocked`, `budget-soft-stopped` red;
      `in-progress`, `paused`, `queued`, `awaiting-human`, `revising` cyan; `live` cyan; `not-live`
      no `color` prop.
- [x] Queue rows color their `status` cell by the same mapping; the `waiting: memory headroom`
      descriptor renders with no `color` prop.
- [x] Concatenating a rendered row's cells yields the same text as that row's `monitorTextLines`
      entry, separators included — the split introduces no spacing change.
- [x] The composing `Revise prompt:` line renders as an uncolored row through the same segment path.
- [x] The tone map is a total record over `RunStatus` with no default arm, and a unit test asserts
      every member of `RUN_STATUSES` resolves to a tone.
- [x] `tui-monitor-lines.test.ts` pins the full `string[]` output of `monitorTextLines` for a
      fixture state and that pin matches today's output; it and `tui-entry.test.tsx` stay green.

## Documentation updates

- `v2/docs/first-workflow-walkthrough.md` — `jarvis tui` run-table description states the semantic
  color treatment of the status and liveness cells and that text remains the primary signal.
- `v2/docs/v1-behaviors.md` — add an entry for the monitor's colored state cells following that
  file's conventions for v2-additive TUI behavior (tag and source citation).
