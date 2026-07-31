# Terminal window renders finishless rows

## Problem

`terminalRunInLiveWindow(undefined, …)` returns `false`, so `filterMonitorRunsForLiveWindow`
drops terminal list rows with no `finishedAtMs` — killed, interrupted, and spawn-failed rows
operators open the TUI to find. Stub invert `test()` bodies remain after invert-hook removal;
they must not be revived as production bypass hooks.

## Decisions

- Terminal row with `finishedAtMs === undefined` is in-window (`terminalRunInLiveWindow` returns
  `true`); rules out fail-closed drop on missing finish time.
- In-window fallback applies only when `finishedAtMs` is absent; rows with a timestamp still use
  the one-hour window; rules out treating stale timestamps as finishless.
- `blocked` ages out like other terminal rows when `finishedAtMs` is older than the window; point
  operators to `jarvis run list --status blocked --since …` in `operator-runbook.md`; rules out a
  `blocked` special-case in the window filter.
- Guard inversion uses `Mutation checkpoint:` comments on pinning tests naming source mutations on
  real guards; rules out `setInvert*ForTest` / `invert*ForTest` production hooks.
- Remove empty `inverted window filter` / `inverted row cap` stub tests; window and row-cap
  criteria stay pinned by mutating `inWindow` and `.slice(0, terminalCap)` respectively; rules out
  dedicated invert `test()` blocks that satisfied criteria without real guards.

## Tasks

- **`tui-monitor-terminal-window.ts`:** when `finishedAtMs === undefined`, return `true` from
  `terminalRunInLiveWindow`; add `Mutation checkpoint:` on the finishless guard naming mutation
  `return true` → `return false` for the undefined branch.
- **`tui-monitor-terminal-window.test.ts`:** add unit coverage that `terminalRunInLiveWindow(undefined,
  …)` is in-window; add `filterMonitorRunsForLiveWindow` coverage keeping a terminal row with
  omitted `finishedAtMs`; add `runTuiEntry` coverage rendering that row in the monitor table;
  delete empty `inverted window filter surfaces terminal runs finished more than one hour ago` and
  `inverted row cap shows every in-window terminal run` stubs; ensure existing `Mutation
  checkpoint:` comments on window-filter and row-cap guards remain on their pinning tests.
- Run `bun run typecheck` and `bun run test:v2`.
- Update durable docs per Documentation updates.

## Acceptance criteria

- [ ] `tui-monitor-terminal-window.test.ts` — `terminalRunInLiveWindow` / `filterMonitorRunsForLiveWindow` / `runTuiEntry` coverage for a terminal row with omitted `finishedAtMs` asserts the row is kept and rendered; fails against pre-fix `return false` on `undefined` and passes after.
- [ ] `tui-monitor-terminal-window.test.ts` — mutating the finishless guard (`return true` → `return false` when `finishedAtMs === undefined`) turns the finishless-row pinning test RED; comment checkpoint on that test names the mutation.
- [ ] (Manual) Mutating the window-filter guard (`return inWindow` → `return !inWindow`, or equivalent) turns `renders in-window terminal rows in finish order, capped at twenty, and keeps old active rows` RED; comment checkpoint names the mutation.
- [ ] (Manual) Mutating the row-cap guard (drop `.slice(0, terminalCap)`) turns `retains non-terminal rows and caps terminal rows by finish time` RED; comment checkpoint names the mutation.
- [ ] `tui-monitor-terminal-window.ts` carries no `setInvert*ForTest` export, `invert*ForTest` module variable, `invert*` function parameter, or `invert*ForTest` type member.
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
