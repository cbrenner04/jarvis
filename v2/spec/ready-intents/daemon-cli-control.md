---
name: daemon-cli-control
---

# Thin CLI control surface over the daemon

Minimal `jarvis` client over the daemon IPC API: daemon `start`/`stop`/`status`, plus run `start` / `list` / `log`(tail) / `pause` / `resume` / `kill`. No orchestration logic in the CLI — thin transport only.

Source: Phase 3 scope (4) in `v2/spec/seeds/phase-3-daemon-host.md`; build-order Phase 3 CLI note in `v2/docs/v2-build-order.md`. Done condition is merged code in `v2/src`, not this intent.

## What exists today

- `v2/src/cli.ts` hosts `jarvis write …` in-process (foreground loop).
- No daemon client commands.

## Scope

- CLI subcommands (exact names in refine) for:
  - Daemon lifecycle: start, stop, status.
  - Run control: start a run, list runs, tail structured log, pause, resume, kill.
- Each command is IPC round-trip/stream only — no local orchestration, no duplicate guard logic.
- Foreground `jarvis write` host remains; daemon path is additive.
- Co-located tests using injectable IPC client / test daemon fixture.

## Out of scope

- TUI (Phase 4) — first interactive client, not this slice.
- Natural-language router, workflow presets, PR lifecycle.
- Changing `executeWriteLoop` or daemon server semantics (owned by sibling intents).

## Decisions

- CLI is a thin IPC client — rules out implementing run guards or steering logic locally.
- Foreground `jarvis write` stays — rules out replacing in-process host with daemon-only entry.
- Deferred to first consumer: command tree shape (`jarvis daemon start` vs top-level `jarvis start`) — pin in refine; tests need stable invocations, not final UX.

## Documentation updates

- Operator-facing v2 doc (whichever durable home already covers CLI entry — likely `v2/docs/` cross-link from build-order) — list daemon control commands once names settle. Skip if no operator doc home exists yet; do not invent a new doc file speculatively.

## Prerequisites

- Daemon programmatic run-control API over IPC (start/list/tail/pause/resume/kill with steering semantics and per-(project,branch) guard)
