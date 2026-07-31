# Terminal window renders finishless rows

## Problem

`terminalRunInLiveWindow` returns `false` when `finishedAtMs` is `undefined`, so
`filterMonitorRunsForLiveWindow` drops finishless terminal rows — killed, interrupted, and
spawn-failed runs operators open the TUI to find. Do not reintroduce `setInvert*ForTest` /
`invert*ForTest` production bypass hooks (invert-hook removal is owned by sibling 05).

## Prerequisites

- Store terminal reconciliation (`v2/spec/completed/20260730T071755Z-store-timestamps-terminal-reconciliation`) merged.
- List `finishedAtMs` honesty (`v2/spec/completed/20260730T084815Z-list-row-step-honesty`) merged.
- `05-tui-monitor-terminal-window-drop-production-invert-hooks` (`v2/spec/20260731T052308Z-execution-loop-drop-production-invert-hooks`) merged before implement.

## Decisions

- Terminal row with `finishedAtMs === undefined` is in-window (`terminalRunInLiveWindow` returns
  `true`); rules out fail-closed drop on missing finish time.
- In-window fallback applies only when `finishedAtMs` is absent; rows with a timestamp still use
  the one-hour window; rules out treating stale timestamps as finishless.
- Finishless rows stay in-window but follow existing finish-order sort (`?? 0`) and the twenty-row
  cap; rules out cap exemption or priority without a separate product decision.
- `blocked` ages out like other terminal rows when `finishedAtMs` is older than the window; point
  operators to `jarvis run list --status blocked --since …` in `operator-runbook.md`; rules out a
  `blocked` special-case in the window filter.

## Tasks

- **`tui-monitor-terminal-window.ts`:** when `finishedAtMs === undefined`, return `true` from
  `terminalRunInLiveWindow`.
- **`tui-monitor-terminal-window.test.ts`:** add `treats missing finishedAtMs as in-window`;
  add `keeps terminal rows with omitted finishedAtMs in the live window` with a `Mutation
  checkpoint:` comment naming `return true` → `return false` on the `finishedAtMs === undefined`
  branch; add `renders finishless terminal rows below the twenty-row cap` using a sparse
  `runTuiEntry` fixture that keeps in-window terminal count below the cap so a finishless row is
  visible once eligible; delete empty invert stub `test()` bodies only if still present after 05.
- Run `bun run typecheck` and `bun run test:v2`.
- Update durable docs per Documentation updates.

## Acceptance criteria

- [ ] `tui-monitor-terminal-window.test.ts` — `treats missing finishedAtMs as in-window`,
  `keeps terminal rows with omitted finishedAtMs in the live window`, and `renders finishless
  terminal rows below the twenty-row cap` fail against pre-fix `return false` on `undefined` and
  pass after the guard change; the render test uses a sparse fixture with in-window terminal count
  below the twenty-row cap.
- [ ] `tui-monitor-terminal-window.test.ts` — mutating the finishless guard (`return true` →
  `return false` when `finishedAtMs === undefined`) turns `keeps terminal rows with omitted
  finishedAtMs in the live window` RED; `Mutation checkpoint:` on that test names the mutation.
- [ ] `tui-monitor-terminal-window.test.ts` — `renders in-window terminal rows in finish order, capped at twenty, and keeps old active rows` stays green.
- [ ] `tui-monitor-terminal-window.test.ts` — `retains non-terminal rows and caps terminal rows by finish time` stays green.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — TUI live-window bullet: `finishedAtMs` sourcing includes store
  `reconciledAt`; terminal rows lacking any finish timestamp stay in the live window; `blocked` rows
  older than one hour drop from the TUI — recover with `jarvis run list --status blocked --since …`
  (or other list filters).
- `v2/docs/v1-behaviors.md` — TUI terminal-window bullet: rows without `finishedAtMs` are in-window;
  `blocked` ages out on `finishedAtMs` like other terminal statuses.
