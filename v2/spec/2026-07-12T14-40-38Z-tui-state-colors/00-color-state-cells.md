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
- Tone mapping is exhaustive over `RUN_STATUSES` (no default arm), so a new run status fails
  typecheck rather than rendering uncolored.
- `completed` → success; `failed`, `killed`, `blocked`, `budget-soft-stopped` → failure;
  `in-progress`, `paused`, `queued`, `awaiting-human`, `revising` → active. Non-success
  terminals share the failure tone; rejected a fourth neutral tone, which the intent's three
  semantics rule out.
- Palette (pinned now — the ink monitor is the first consumer): active `cyan`, success `green`,
  failure `red`.
- `live` takes the active tone; `not-live` is uncolored — it is a liveness fact, not a terminal
  outcome.
- Only status and liveness cells are toned. Row markers, headers, queue admission descriptor,
  workflow lines, outcome panel, and steering feedback stay uncolored.

## Task checklist

- [ ] Add a segment model + tone classifier to `v2/src/tui/tui-monitor-lines.ts`; keep
      `monitorTextLines` as the joined-text view over it.
- [ ] Render run-table and queue rows in `tui-ink-monitor.tsx` as a row of `Text` cells, coloring
      only the toned ones.
- [ ] Unit-test the tone mapping across all `RUN_STATUSES` and both liveness values.
- [ ] Update `v2/docs/first-workflow-walkthrough.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] Each run-table row renders `status` and `liveness` as distinct ink `Text` cells; every other
      cell in the row keeps its current text and no color.
- [ ] Status text is unchanged from today and always rendered — color is additive, never the only
      state signal.
- [ ] `completed` renders green; `failed`, `killed`, `blocked`, and `budget-soft-stopped` render
      red; `in-progress`, `paused`, `queued`, `awaiting-human`, and `revising` render cyan.
- [ ] `live` renders cyan; `not-live` renders uncolored.
- [ ] Queue rows color their `status` cell by the same mapping; the `waiting: memory headroom`
      descriptor is uncolored.
- [ ] Adding a value to `RUN_STATUSES` without extending the tone mapping fails `bun run typecheck`.
- [ ] `tui-monitor-lines.test.ts` and `tui-entry.test.tsx` stay green: `monitorTextLines` output is
      byte-identical to today's.

## Documentation updates

- `v2/docs/first-workflow-walkthrough.md` — `jarvis tui` run-table description states the semantic
  color treatment of the status and liveness cells and that text remains the primary signal.
- `v2/docs/v1-behaviors.md` — record the monitor's colored state cells (changes existing v2 TUI
  rendering behavior).
