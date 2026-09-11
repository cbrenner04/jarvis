---
name: connect-operator-clients-to-stable-daemon
---

# Connect every operator client to the stable daemon

## Prerequisites

- Daemon upgrades hand off one stable public address: the incoming generation admits new work, the outgoing generation admits nothing new, finishes its owned work, and exits when idle.
- The stable daemon exposes each draining-generation run as live and routes run observation, waits, logs, and controls to its authoritative owner.
- The stable daemon exposes one complete pipeline namespace and routes every pipeline verb to the generation owning its live work.

## Module-boundary surface

- Client-side daemon resolution shared by CLI bootstrap, daemon/init commands, run and pipeline commands, cleanup admission checks, runtime smoke verification, and TUI observation/control.

## Problem

CLI bootstrap computes the executable digest, injects digest-keyed lifecycle paths, and gives observers socket discovery so each surface can merge or route across versions. This makes `daemon status`, `init --check`, `cleanup --abandon`, run/pipeline commands, and the TUI disagree after a source change.

## Behavior

- Every operator-facing client connects only to the stable daemon address and relies on that service for generation-transparent observation and routing.

## Decision ledger

- Remove executable-digest resolution from daemon location and use the stable socket, PID, and process-log paths for lifecycle commands and auto-start.
- Make `daemon status` report the serving daemon as `running` even when its loaded executable digest differs from the invoking source; retain loaded/current revision display as information, not reachability or failure.
- Make `init --check`, `cleanup --abandon`, run commands, pipeline commands, runtime smoke verification, and TUI clients use the same stable endpoint; rules out surface-specific fallback discovery.
- Delete client-side live-daemon socket enumeration, multi-socket list merging, and owner probing once the stable daemon supplies those views; rules out version coupling returning through a new command.
- Add a structural guard over CLI and command/TUI client layers proving no source digest is computed or digest-keyed socket set enumerated to locate a daemon.

## Acceptance criteria

- [ ] A CLI lifecycle test proves `daemon status` prints `running` and exits zero while a daemon serves the stable socket with a different loaded executable digest; it fails against the pre-fix digest-scoped probe/stale result.
- [ ] Command tests prove `init --check` and `cleanup --abandon` reach a healthy stable daemon after the invoking source changes.
- [ ] End-to-end client tests prove run list/log/wait/kill and every pipeline verb use only the stable socket while still reaching draining-owned work.
- [ ] TUI monitor, log-follow, and steering tests prove one stable connection presents current and draining work without client-side socket discovery or cross-socket ownership maps.
- [ ] A structural test proves production CLI, command, runtime-smoke, and TUI client layers neither compute an executable digest nor enumerate digest-keyed sockets to locate a daemon; it fails against the pre-fix bootstrap and discovery modules.
- [ ] Existing command output, run/pipeline exit-code, filtering, and TUI presentation tests stay green at their cited source paths.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — stable daemon CLI, auto-start, run/pipeline routing, TUI connection, and status semantics.
- `v2/docs/operator-runbook.md` — remove digest-rotation, superseded-daemon, cross-project merge hazard, and live-lane merge restrictions; state that upgrades require no operator awareness.
- `v2/docs/install-and-config.md` — stable lifecycle paths and readiness checks.
- `v2/docs/first-workflow-walkthrough.md` — stable auto-start and observation language.
- `v2/docs/tui.md` — one stable daemon connection with unified routed state.
- `v2/docs/v2-architecture.md` — client-to-daemon connection boundary.
- `v2/docs/v1-behaviors.md` — replace client-side keyed discovery and aggregation behavior.
