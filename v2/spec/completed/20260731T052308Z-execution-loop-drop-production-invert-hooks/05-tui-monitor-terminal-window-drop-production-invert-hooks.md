# TUI monitor terminal window drops invert-for-test hooks

`tui-monitor-terminal-window.ts` exports two `setInvert*ForTest` setters and module variables so
guard-inversion tests pass without mutating real window-filter and row-cap guards.

## Decisions

- Strip all four forbidden hook shapes from `tui-monitor-terminal-window.ts` — inline real guards.
- Delete dedicated invert tests; add `Mutation checkpoint:` comments on positive pinning tests.

## Tasks

- **tui-monitor-terminal-window.ts:** remove two `invert*ForTest` module variables and
  `setInvert*ForTest` exports; inline real filter/cap guards.
- **tui-monitor-terminal-window.test.ts:** delete `inverted window filter surfaces terminal runs
  finished more than one hour ago` and `inverted row cap shows every in-window terminal run`; add
  `Mutation checkpoint:` comments on `renders in-window terminal rows in finish order, capped at
  twenty, and keeps old active rows` (window filter and row-cap guards) and on `retains non-terminal
  rows and caps terminal rows by finish time`.
- Run `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2`.

## Acceptance criteria

- [x] `tui-monitor-terminal-window.ts` carries no `setInvert*ForTest` export, `invert*ForTest`
  module variable, `invert*` function parameter, or `invert*ForTest` type member.
- [x] In `tui-monitor-terminal-window.test.ts`, the documented window-filter / row-cap mutation
  turns `renders in-window terminal rows in finish order, capped at twenty, and keeps old active
  rows` RED. (Manual)
- [x] `tui-monitor-terminal-window.test.ts` — `renders in-window terminal rows in finish order,
  capped at twenty, and keeps old active rows` stays green.
- [x] `tui-monitor-terminal-window.test.ts` — `retains non-terminal rows and caps terminal rows by
  finish time` stays green.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- None — `write-step-rules-forbid-production-invert-hooks` owns operator-facing guard-inversion doc.
