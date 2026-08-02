# 00 - Project four dock rows

## Problem

Dock state has no pure, CI-observable projection.

## Decisions

- `TuiMonitorState` owns command buffer, cursor, focus, last result/error, machine profile, and keyed-socket digest — rules out Ink-local state or renderer arguments.
- One pure `tui-monitor-lines.ts` projection returns status, prompted input with a visible cursor marker, continuation, and hints in that order — rules out a dock-specific rendering model.
- Status counts each pipeline id once from `pipelineSnapshotsBySocketPath`; an id is active if any retained observation is non-terminal, including a contradictory terminal observation — rules out live-run counts and duplicate cross-daemon snapshots.
- Status identifies only the invoking machine profile and keyed-socket digest, appends refresh interval, and shows last RPC error ahead of a retained command result; command-result production is deferred to the editor/dispatch slice.
- Projection sanitizes controls and line breaks and bounds every row to the available display columns, so four strings are four physical terminal rows in either shell.
- Cursor is a grapheme-cluster offset in the unchanged buffer, clamped to its inclusive grapheme boundary range. Tabs expand at four-column stops; CR/LF and other controls become one-column visible replacements. The `> ` prompt consumes display columns, and a one-column row paints the cursor alone. A grapheme wider than the row becomes a one-column replacement rather than splitting.
- Input uses a two-row display-column window containing the cursor; omitted text remains in the unchanged buffer. Exact fit, one-column overflow, and start/middle/end cursor positions choose the same deterministic window.
- Tree focus always advertises global controls plus only applicable expansion and kill controls. Expansion is eligible only for expandable selected tree nodes; kill is eligible only for a selected live, non-terminal actionable run. No selection, terminal/non-live runs, and other nodes omit them. Command focus advertises its defined command copy and no tree actions.

## Work

- Add dock session fields to `v2/src/tui/tui-monitor-types.ts` with safe projection defaults for existing state fixtures.
- Add the four-row projection to `v2/src/tui/tui-monitor-lines.ts` using terminal display width and control-safe text.
- Add focused projection and mutation coverage in `v2/src/tui/tui-monitor-lines.test.ts`.

## Acceptance criteria

- [ ] `v2/src/tui/tui-monitor-lines.test.ts` adds a projection regression that fails against the hardcoded baseline and proves one call returns exactly four ordered rows: status, prompted input with a visible cursor, continuation, and hints.
- [ ] Status reports each distinct pipeline once; contradictory terminal/non-terminal observations remain active, duplicate snapshots do not inflate the count, and retained snapshots still count after a refresh failure. It reports invoking profile/keyed-socket digest, refresh interval, and RPC error ahead of a retained result when both exist.
- [ ] At split and stacked widths, rendered row text is control/newline-safe and display-width-bounded, so empty, exact-fit, one-column-overflow, and longer-than-two-row input produce four non-wrapping physical rows. Coverage proves prompt accounting, tabs/newlines, tiny widths, and over-wide graphemes without splitting a grapheme.
- [ ] For start, middle, and end cursor positions, projection clamps the grapheme-offset cursor, keeps its marker visible across the two-row window, and leaves buffer and cursor unchanged.
- [ ] Tree-focus hints retain global controls; they omit expansion and kill for absent, terminal, non-live, and otherwise non-actionable selections, include each only when applicable, and command focus shows command copy with no tree actions.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` carries one valid `// @mutate` directive for every added or modified executable projection guard, including effect-suppressing guards; inverting each real source condition turns its pin red, with no production inversion hook.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

None — this slice adds an internal projection; the Ink consumer and durable operator docs land in 01.
