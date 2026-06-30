# 01 — TUI entry and connect UX

First interactive v2 client: a terminal UI entry command that connects to the
running daemon over the production socket, proves liveness, and gives clear
operator feedback when the daemon is unavailable. No run orchestration.

## Prerequisites

- Merged TUI daemon client:
  `v2/spec/2026-06-30T18-32-35Z-tui-scaffold/00-tui-daemon-client.md`.

## Decisions

- `jarvis tui` closes entry-command deferral — rules out bare `jarvis` opening the TUI and `jarvis ui` as the primary entry.
- Terminal UI library: `ink` — rules out stdout-only placeholder UI and alternate TUI stacks for this slice.
- Connected scaffold session: prove liveness via the 00 client, render feedback through ink, then exit `0` — rules out blocking for operator quit and indefinite hang after liveness proof.
- Unavailable daemon: render an actionable error naming `~/.jarvis/daemon.sock` and `jarvis daemon start`, then exit `1` — rules out silent failure, hang/retry loops, auto-starting the daemon, and non-`1` exit codes.
- Connected operator contract: view host records that IPC `health` returned `{ ok: true }` and IPC `status` returned `{ state: "running" }` — rules out showing only one RPC result or conflating IPC `status` with `jarvis daemon status` CLI output; exact copy/layout deferred to run-monitor slice.
- Deferred to first consumer: connected-screen layout beyond liveness proof — pin when run-monitor slice needs it.
- Entry uses the 00 daemon client only — rules out direct `connectIpcClient` calls in the TUI entry layer and rules out local `executeWriteLoop` / run-guard logic.
- Scaffold invokes only IPC `health` and `status` — rules out `start`, `list`, `pause`, `resume`, `kill`, `wait`, `shutdown`, and stream frames (`stream-open`, `stream-data`, `stream-end`).
- Foreground `jarvis write` and `jarvis run` hosts stay — rules out daemon-only or TUI-only entry replacing them.
- Co-located tests inject a view/render host — rules out live-terminal-only automated coverage.

## Task checklist

- Add `ink` dependency; production entry renders through ink (not stdout shim).
- Add `jarvis tui` parsing in `v2/src/cli.ts` (or sibling entry wiring) that launches the TUI host.
- On launch: connect via the 00 client at the production socket unless tests inject a path.
- Connected path: show operator-visible connected/liveness feedback from `health` and IPC `status`; exit `0`.
- Unavailable path: show the pinned unavailable-daemon message; exit `1`.
- Do not invoke run-control RPCs, streams, or `executeWriteLoop`.
- Co-locate tests with injectable daemon client and view host fakes.
- Update durable docs per Documentation updates.

## Acceptance criteria

- [x] `jarvis tui` launches the ink-based TUI entry using `~/.jarvis/daemon.sock` unless tests inject a socket path.
- [x] Production `jarvis tui` imports and renders through `ink` (not a stdout-only shim).
- [x] When the daemon is reachable, `jarvis tui` completes IPC `health` and IPC `status` through the 00 client, the injectable view host records both successes, then exits `0`.
- [x] When the daemon socket is unreachable, `jarvis tui` records operator-visible feedback that names `~/.jarvis/daemon.sock`, mentions `jarvis daemon start`, exits `1`, and does not invoke run-control RPCs or `executeWriteLoop`.
- [x] `jarvis tui` invokes only IPC `health` and `status`; it does not send `start`, `list`, `pause`, `resume`, `kill`, `wait`, `shutdown`, or stream frames.
- [x] `v2/src/cli.test.ts` coverage for `jarvis write`, `jarvis daemon`, and `jarvis run` stays green.
- [x] Co-located tests cover connected and unavailable-daemon paths with injectable daemon client and view-host fakes.
- [x] `v2/docs/write-behavior.md` adds a `jarvis tui` row in the daemon/run command table shape: production socket default, connected vs unavailable operator contract, exit codes (`0` connected, `1` unavailable), cross-links to daemon lifecycle commands.
- [x] `v2/docs/v2-architecture.md` Interface reconciles the aspirational TUI paragraph with a shipped scaffold subsection (connect/liveness over production IPC; launch/monitor/steer remain sibling work) and removes stale “production defaults deferred to first consumer” lifecycle wording now that CLI and TUI pin paths.
- [x] `v2/docs/daemon-host.md` cross-links `jarvis tui` as a consumer-layer socket-default caller (`~/.jarvis/daemon.sock`), not a transport-layer default.
- [x] Operator docs distinguish IPC `status` (`{ state: "running" }` liveness RPC) from `jarvis daemon status` CLI output (`running`/`stopped` lifecycle probe).

## Documentation updates

- [`v2/docs/write-behavior.md`](../../docs/write-behavior.md) — `jarvis tui` table row, socket default, connected vs unavailable behavior, exit codes, daemon-start remediation.
- [`v2/docs/v2-architecture.md`](../../docs/v2-architecture.md) Interface — shipped scaffold vs aspirational TUI; refresh lifecycle default bullet.
- [`v2/docs/daemon-host.md`](../../docs/daemon-host.md) — cross-link `jarvis tui` as socket-default consumer.
