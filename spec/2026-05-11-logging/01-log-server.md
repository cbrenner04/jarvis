# 01 — Log aggregation server (mandatory during `jarvis run`)

## Problem

The user wants a **trivial**, extendable server run from a terminal in this repo (`jarvis`). All Jarvis sessions (multiple concurrent OK) attach to it so the terminal shows **namespaced**, merged activity. If the server is absent, **`jarvis run` must exit with an error** (no fallback for v1).

## Decisions

- **Transport**: keep v1 deliberately small — e.g. **HTTP on localhost**, single endpoint that accepts streamed or posted log lines **or** a single **WebSocket/SSE-style** attachment (pick one minimal approach in implementation; document port and URI in README).
- **Discovery**: configurable URL (preferred: field in **`~/.jarvis/config.json`** so CLI stays simple). Alternate env var acceptable if documented; define precedence explicitly.
- **Process model**: explicit **subcommand** (e.g. `jarvis log-server` — exact name chosen in impl) alongside `run`; start it manually in another terminal.
- **Concurrency**: multiplex many sessions into one viewer; **every line or message must carry namespace** (`projects` registry key).
- **Connection check**: fail fast **before** the run loop begins if server unreachable (clear stderr message pointing at `jarvis log-server` and/or config).

## Tasks

- [ ] Add config surface for server URL/bind (minimum needed for localhost client).
- [ ] Implement aggregation server runnable from this codebase.
- [ ] Implement client send path used by harness (minimal payload schema: namespace + text + annotations from `02-run-logging`).
- [ ] `jarvis run`: if server unreachable, non‑zero exit and **no silent degradation**.

## Acceptance criteria

- Manual smoke: server terminal shows interleaved namespaces from two concurrent runs.
- `bun test` covers connection failure (`run` refuses) with injected server URLs / mocks.
- Lint/typecheck clean.

## Documentation updates

- `README.md`: how to configure URL, start the server first, typical two‑terminal workflow.
