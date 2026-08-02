# 00 - Project four dock rows

## Problem

Dock state has no pure, CI-observable projection.

## Decisions

- `TuiMonitorState` owns command buffer, cursor, focus, last result/error, machine profile, and keyed-socket digest — rules out Ink-local state or renderer arguments.
- One pure `tui-monitor-lines.ts` projection returns status, prompted input with a visible cursor marker, continuation, and hints in that order — rules out a dock-specific rendering model.
- Status counts unique non-terminal pipeline ids from `pipelineSnapshotsBySocketPath`, not live run rows or duplicate cross-daemon snapshots.
- Status identifies the invoking machine profile and keyed socket digest, not every discovered daemon; it appends refresh interval and the latest command result or RPC error when present.
- Input uses a display-column window of at most two fixed rows containing the cursor; omitted text remains in the unchanged buffer — rules out dock growth, buffer truncation, or splitting grapheme clusters.
- Tree-focus hints include only controls applicable to the selected node; command focus suppresses tree actions — rules out static hints advertising invalid actions.
- Deferred to first consumer: command-focus hint copy beyond suppressing tree actions — pin when the editor can enter command focus.

## Work

- Add dock session fields to `v2/src/tui/tui-monitor-types.ts` with safe projection defaults for existing state fixtures.
- Add the four-row projection to `v2/src/tui/tui-monitor-lines.ts` using terminal display width.
- Add focused projection and mutation coverage in `v2/src/tui/tui-monitor-lines.test.ts`.

## Acceptance criteria

- [ ] `v2/src/tui/tui-monitor-lines.test.ts` adds a projection regression that fails against the hardcoded baseline and proves one call returns exactly four ordered rows: status, prompted input with a visible cursor, continuation, and hints.
- [ ] Status reports the unique non-terminal pipeline count, invoking machine profile/keyed-socket digest, refresh interval, and the latest command result or RPC error when present; duplicate pipeline snapshots do not inflate the count.
- [ ] Empty input and input wider than two dock rows both project exactly four rows at split and stacked terminal widths; the cursor remains visible and the input buffer and cursor are unchanged after projection.
- [ ] Tree-focus hints omit expansion and kill when the selection cannot perform them, include each when applicable, and command focus suppresses tree actions.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` carries one valid `// @mutate` directive for every added or modified projection guard; inverting each real source condition turns its pin red, with no production inversion hook.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

None — this slice adds an internal projection; the Ink consumer and durable operator docs land in 01.
