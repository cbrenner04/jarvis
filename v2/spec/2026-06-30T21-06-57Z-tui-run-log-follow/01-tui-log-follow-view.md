# 01 — TUI log follow view

Operator-facing log follow surface: open a run's structured log stream over the
00 tail client, render minimal lines as events arrive, exit on operator quit,
benign server close, or tail failure. Separate from the connect scaffold and run
dashboard.

## Prerequisites

- Merged TUI log tail client:
  `v2/spec/2026-06-30T21-06-57Z-tui-run-log-follow/00-tui-log-tail-client.md`.

## Decisions

- `jarvis tui log <run-id>` is the entry command — rules out dashboard-only navigation and `jarvis run log` subprocess wrapping.
- Bare `jarvis tui` connect scaffold stays unchanged — rules out folding log follow into the no-arg entry.
- Log follow is a separate ink session from the dashboard — rules out full-screen dashboard layout in this slice.
- Production `follow` tail blocks after replay; server does not emit benign `stream-end` on replay completion alone — rules out auto-exit after replay via `list`/`wait`.
- After replay, session stays open for live appends and operator quit even when the run is quiescent — rules out treating replay completion as session end.
- Benign server `stream-end` (injectable fake or unknown run) ends session `0` — rules out conflating test/server-close seam with production idle semantics.
- Injectable quit seam ends session `0` and calls tail client `close()` (`stream-end`) — rules out quit without follow abort.
- Deferred to first consumer: production quit keybinding and Ctrl-C/SIGINT binding — pin as dogfooding learns.
- View unmount, injectable quit, and normal exit propagate tail client `close()` — rules out leaking blocking follow subscriptions.
- Per-line field projection (present nested fields only):

  | `event.kind` | fields |
  |---|---|
  | `iteration_started` | `attemptId` |
  | `boundary_committed` | `attemptId`, `outcomeKind`, `runStatus` |
  | `loop_finished` | `loopOutcomeKind`, `iterationsConsumed`, `resumable` |
  | `run_execution_failed` | kind only |

  — rules out flattening unrelated `event.*` keys or JSONL mirroring `jarvis run log`.
- Unknown run (benign `stream-end` with no records): zero event lines, exit `0` — rules out client-side run lookup or error exit for empty tail.
- Pre-connect unreachable daemon: reuse `TUI_DAEMON_SOCKET_DISPLAY` and `showTuiInkFeedback` unavailable pattern from scaffold — rules out ad hoc remediation strings; exit `1`.
- Mid-follow `TuiDaemonConnectionError` (connection loss or error-payload `stream-end`): operator-visible failure feedback, exit `1` — rules out `jarvis run log` `connection closed` → `0` parity.
- Production entry renders through ink — rules out stdout-only placeholder UI.
- Co-located tests inject a view host and quit seam — rules out live-terminal-only automated coverage.
- Deferred to first consumer: scroll UX, colors, delimiter polish, and multi-window vs split-pane mechanics — pin as dogfooding learns.

## Task checklist

- Add `jarvis tui log <run-id>` parsing in `v2/src/cli.ts` (or sibling entry wiring) dispatching to a log-follow host.
- On launch: connect via the 00 tail client at the production socket unless tests inject a path.
- For each `PersistedRecord`: append one operator-visible line with `seq`, `event.kind`, and per-kind fields from Decisions.
- Replay persisted records, render live appends, then idle until operator quit or benign server `stream-end`.
- On injectable quit or view teardown: call tail client `close()`.
- Wrong arity (`jarvis tui log` with no run id, or extra args): print usage, exit `1`.
- Do not invoke run-control RPCs (`start`, `list`, `pause`, `resume`, `kill`, `wait`) or the connect-scaffold-only `health`/`status` path in this entry.
- Co-locate tests with injectable tail client, view host, and quit seam.
- Update durable docs per Documentation updates.

## Acceptance criteria

- [x] `jarvis tui log <run-id>` launches an ink-based log follow session using `~/.jarvis/daemon.sock` unless tests inject a socket path.
- [x] Production `jarvis tui log` imports and renders through `ink` (not a stdout-only shim).
- [x] With an injectable tail client yielding fixture records in server arrival order, the view host records one line per record including `seq`, `event.kind`, and per-kind fields from Decisions, in arrival order.
- [x] With an injectable tail client that blocks after replay without benign `stream-end`, the session stays open until injectable quit; quit yields exit `0` and tail client `close()`.
- [x] With an injectable tail client, benign server `stream-end` after replay ends the session with exit `0`.
- [x] With an injectable tail client simulating a live append after replay, the view host records the new line before session end.
- [x] With an injectable tail client yielding no records (immediate benign `stream-end`), the view host records zero event lines and the session exits `0`.
- [x] With an injectable tail client rejecting mid-session with `TuiDaemonConnectionError`, log follow records operator-visible failure feedback and exits `1`.
- [x] When the daemon socket is unreachable, log follow records operator-visible feedback using `TUI_DAEMON_SOCKET_DISPLAY` and `jarvis daemon start` remediation (scaffold unavailable pattern), exits `1`, and does not open a tail stream.
- [x] `jarvis tui log` with missing or extra arguments prints usage and exits `1`.
- [x] `jarvis tui` with no arguments keeps existing connect-scaffold behavior (`v2/src/tui-entry.test.tsx` stays green).
- [x] `v2/src/cli.test.ts` coverage for `jarvis write`, `jarvis daemon`, and `jarvis run` stays green.
- [x] Co-located tests cover replay, blocking-after-replay quit, server-close, live append, empty tail, mid-session tail failure, and unavailable-daemon paths with injectable tail client, view-host, and quit fakes.
- [x] Co-located tests assert each rendered line includes at least `seq`, `event.kind`, and every present per-kind field from Decisions.
- [x] `v2/docs/write-behavior.md` adds a `jarvis tui log <run-id>` row in the TUI CLI table: production socket default; minimum line shape (`seq`, `event.kind`, present per-kind fields); exit codes (`0` on benign stream end/quit, `1` on unavailable daemon, mid-session tail failure, or usage error); daemon-start remediation.
- [x] `v2/docs/v2-architecture.md` Interface records shipped log follow (`jarvis tui log <run-id>`) as a separate TUI surface over the IPC tail stream; dashboard launch/monitor/steer remain sibling work.
- [x] `v2/docs/daemon-host.md` cross-links `jarvis tui log <run-id>` as a consumer-layer socket-default caller over IPC tail, same pattern as `jarvis tui`.

## Documentation updates

- [`v2/docs/write-behavior.md`](../../docs/write-behavior.md) — `jarvis tui log <run-id>` table row, socket default, minimum line shape, exit codes, daemon-start remediation.
- [`v2/docs/v2-architecture.md`](../../docs/v2-architecture.md) Interface — shipped log follow view vs aspirational dashboard.
- [`v2/docs/daemon-host.md`](../../docs/daemon-host.md) — cross-link `jarvis tui log` as socket-default tail consumer.
