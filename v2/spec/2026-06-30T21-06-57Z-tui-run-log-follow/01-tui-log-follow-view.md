# 01 — TUI log follow view

Operator-facing log follow surface: open a run's structured log stream over the
00 tail client, render minimal lines as events arrive, exit when the stream ends
or the operator quits. Separate from the connect scaffold and run dashboard.

## Prerequisites

- Merged TUI log tail client:
  `v2/spec/2026-06-30T21-06-57Z-tui-run-log-follow/00-tui-log-tail-client.md`.

## Decisions

- `jarvis tui log <run-id>` is the entry command — rules out dashboard-only navigation and `jarvis run log` subprocess wrapping.
- Bare `jarvis tui` connect scaffold stays unchanged — rules out folding log follow into the no-arg entry.
- Log follow is a separate ink session from the dashboard — rules out full-screen dashboard layout in this slice.
- Renders `PersistedRecord` lines (seq + event kind + kind-specific key fields) — rules out JSONL stdout mirroring `jarvis run log`.
- Session runs until tail stream ends or operator quit — rules out auto-exit after replay while the run is still live.
- Unknown run (server closes tail with no records): render zero event lines, exit `0` — rules out client-side run lookup or error exit for empty tail.
- Unreachable daemon: reuse unavailable feedback naming `~/.jarvis/daemon.sock` and `jarvis daemon start`, exit `1` — rules out hang/retry and auto-starting the daemon.
- Production entry renders through ink — rules out stdout-only placeholder UI.
- Co-located tests inject a view host — rules out live-terminal-only automated coverage.
- Deferred to first consumer: production quit keybinding, scroll UX, colors, and multi-window vs split-pane mechanics — pin as dogfooding learns; tests use injectable quit/abort seam.
- Deferred to first consumer: exact line copy beyond seq/kind/key fields — pin in refine.

## Task checklist

- Add `jarvis tui log <run-id>` parsing in `v2/src/cli.ts` (or sibling entry wiring) dispatching to a log-follow host.
- On launch: connect via the 00 tail client at the production socket unless tests inject a path.
- For each `PersistedRecord`: append one operator-visible line with `seq`, `event.kind`, and key fields (`attemptId`, `outcomeKind`, `runStatus`, `loopOutcomeKind`, `iterationsConsumed`, `resumable` as present).
- Replay persisted records, then render live appends until stream end or operator quit.
- Wrong arity (`jarvis tui log` with no run id, or extra args): print usage, exit `1`.
- Do not invoke run-control RPCs (`start`, `list`, `pause`, `resume`, `kill`, `wait`) or the connect-scaffold-only `health`/`status` path in this entry.
- Co-locate tests with injectable tail client, view host, and quit seam.
- Update durable docs per Documentation updates.

## Acceptance criteria

- [ ] `jarvis tui log <run-id>` launches an ink-based log follow session using `~/.jarvis/daemon.sock` unless tests inject a socket path.
- [ ] With an injectable tail client yielding fixture records in `seq` order, the view host records one line per record including `seq`, `event.kind`, and kind-specific key fields, in arrival order.
- [ ] With an injectable tail client, when the tail completes after replay with no further frames, the session exits `0`.
- [ ] With an injectable tail client simulating a live append after replay, the view host records the new line before session end.
- [ ] With an injectable tail client yielding no records (immediate stream end), the view host records zero event lines and the session exits `0`.
- [ ] When the daemon socket is unreachable, log follow records operator-visible feedback naming `~/.jarvis/daemon.sock` and `jarvis daemon start`, exits `1`, and does not open a tail stream.
- [ ] `jarvis tui log` with missing or extra arguments prints usage and exits `1`.
- [ ] `jarvis tui` with no arguments keeps existing connect-scaffold behavior (`v2/src/tui-entry.test.tsx` stays green).
- [ ] `v2/src/cli.test.ts` coverage for `jarvis write`, `jarvis daemon`, and `jarvis run` stays green.
- [ ] Co-located tests cover replay, live append, empty tail, and unavailable-daemon paths with injectable tail client and view-host fakes.
- [ ] `v2/docs/write-behavior.md` adds a `jarvis tui log <run-id>` row in the TUI CLI table: production socket default, structured log follow output contract, exit codes (`0` on stream end/quit, `1` on unavailable daemon or usage error).
- [ ] `v2/docs/v2-architecture.md` Interface records shipped log follow (`jarvis tui log <run-id>`) as a separate TUI surface over the IPC tail stream; dashboard launch/monitor/steer remain sibling work.

## Documentation updates

- [`v2/docs/write-behavior.md`](../../docs/write-behavior.md) — `jarvis tui log <run-id>` table row, socket default, follow output contract, exit codes, daemon-start remediation.
- [`v2/docs/v2-architecture.md`](../../docs/v2-architecture.md) Interface — shipped log follow view vs aspirational dashboard.
