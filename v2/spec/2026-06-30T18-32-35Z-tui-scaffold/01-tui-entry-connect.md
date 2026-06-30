# 01 — TUI entry and connect UX

First interactive v2 client: a terminal UI entry command that connects to the
running daemon over the production socket, proves liveness, and gives clear
operator feedback when the daemon is unavailable. No run orchestration.

## Prerequisites

- Merged TUI daemon client:
  `v2/spec/2026-06-30T18-32-35Z-tui-scaffold/00-tui-daemon-client.md`.

## Decisions

- `jarvis tui` closes entry-command deferral — rules out bare `jarvis` opening the TUI and `jarvis ui` as the primary entry.
- Deferred to first consumer: terminal UI library — pin in this subspec's Decisions before adding a dependency; rules out stdout-only placeholder UI.
- Deferred to first consumer: connected-screen layout beyond liveness proof — pin when run-monitor slice needs it.
- Entry uses the 00 daemon client only — rules out direct `connectIpcClient` calls in the TUI entry layer and rules out local `executeWriteLoop` / run-guard logic.
- Unavailable daemon: render an actionable error naming `~/.jarvis/daemon.sock` and `jarvis daemon start`, then exit non-zero — rules out silent failure, hang/retry loops, and auto-starting the daemon from the TUI.
- Connected scaffold proves daemon liveness (`health` + `status`) in the UI — rules out run list, log tail, launch forms, and steering controls in this slice.
- Foreground `jarvis write` and `jarvis run` hosts stay — rules out daemon-only or TUI-only entry replacing them.
- Co-located tests inject a view/render host — rules out live-terminal-only automated coverage.

## Task checklist

- Pin the terminal UI library in Decisions before adding the dependency.
- Add `jarvis tui` parsing in `v2/src/cli.ts` (or sibling entry wiring) that launches the TUI host.
- On launch: connect via the 00 client at the production socket unless tests inject a path.
- Connected path: show operator-visible connected/liveness feedback from `health` and `status`.
- Unavailable path: show the pinned unavailable-daemon message; exit non-zero.
- Do not invoke run-control RPCs, streams, or `executeWriteLoop`.
- Co-locate tests with injectable daemon client and view host fakes.
- Update durable docs per Documentation updates.

## Acceptance criteria

- [ ] `jarvis tui` launches the interactive TUI entry using `~/.jarvis/daemon.sock` unless tests inject a socket path.
- [ ] When the daemon is reachable, `jarvis tui` completes `health` and `status` through the 00 client and the injectable view host records operator-visible connected/liveness feedback before the session ends.
- [ ] When the daemon socket is unreachable, `jarvis tui` records operator-visible feedback that names `~/.jarvis/daemon.sock`, mentions `jarvis daemon start`, exits non-zero, and does not invoke run-control RPCs or `executeWriteLoop`.
- [ ] `jarvis tui` does not call daemon `start`, `list`, `log`, `pause`, `resume`, `kill`, or `wait`.
- [ ] Existing `v2/src/cli.test.ts` coverage for `jarvis write`, `jarvis daemon`, and `jarvis run` stays green.
- [ ] Co-located tests cover connected and unavailable-daemon paths with injectable daemon client and view-host fakes.
- [ ] `v2/docs/write-behavior.md` documents `jarvis tui` entry, production socket default, connected vs unavailable operator contract, and cross-links daemon lifecycle commands.
- [ ] `v2/docs/v2-architecture.md` Interface records the shipped TUI scaffold (entry over production IPC; full launch/monitor/steer surfaces remain sibling work).

## Documentation updates

- [`v2/docs/write-behavior.md`](../../docs/write-behavior.md) — `jarvis tui` entry, socket default, connected vs unavailable behavior, daemon-start remediation.
- [`v2/docs/v2-architecture.md`](../../docs/v2-architecture.md) Interface — TUI scaffold shipped; defer launch/monitor/steer detail to sibling intents.
