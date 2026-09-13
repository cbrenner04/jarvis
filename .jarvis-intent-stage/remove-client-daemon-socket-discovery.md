---
name: remove-client-daemon-socket-discovery
---

# Remove client-side daemon socket discovery

## Prerequisites

- Daemon upgrades hand off one stable public address: the incoming generation admits new work, the outgoing generation admits nothing new, finishes its owned work, and exits when idle.
- The stable daemon exposes each draining-generation run as live and routes run observation, waits, logs, and controls to its authoritative owner.
- The stable daemon exposes one complete pipeline namespace and routes every pipeline verb to the generation owning its live work.
- `daemon status` prints `running` for any daemon serving the stable socket and renders only the version identity its decision consumed.

## Problem

CLI bootstrap computes the executable digest, injects digest-keyed lifecycle paths, and gives observers socket discovery so each surface merges or routes across versions. `cleanup --abandon`, run/pipeline commands, runtime smoke, and the TUI disagree after a source change.

## Behavior

- Every operator-facing client (CLI bootstrap, daemon/init, run, pipeline, cleanup admission, runtime smoke, TUI) connects only to the stable `daemon.sock`/`daemon.pid`/process-log paths and relies on the daemon for generation-transparent observation and routing.

## Decisions

- Remove executable-digest resolution from client daemon location and auto-start.
- Delete client-side live-daemon socket enumeration, multi-socket list merging, and owner probing; no surface-specific fallback discovery.
- Add a structural guard over CLI, command, runtime-smoke, and TUI client layers.
- No `init --check` criterion: stable paths already apply.

## Acceptance criteria

- [ ] A command test proves `cleanup --abandon` reaches a healthy stable daemon after the invoking source changes.
- [ ] End-to-end client tests prove run list/log/wait/kill and every pipeline verb use only the stable socket while still reaching draining-owned work.
- [ ] TUI monitor, log-follow, and steering tests prove one stable connection presents current and draining work without client-side socket discovery or cross-socket ownership maps.
- [ ] A structural test proves production CLI, command, runtime-smoke, and TUI client layers neither compute an executable digest nor enumerate digest-keyed sockets to locate a daemon; it fails against the pre-fix bootstrap and discovery modules.
- [ ] `v2/src/commands/run.test.ts`, `v2/src/commands/pipeline.test.ts`, `v2/src/commands/run-list-dimension-filters.test.ts`, `v2/src/commands/run-list-query-limit-cap.test.ts`, `v2/src/tui/tui-monitor-pipeline-tree.test.ts`, and `v2/src/tui/tui-attention-rows.test.ts` stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — stable daemon CLI, auto-start, run/pipeline routing, TUI connection.
- `v2/docs/operator-runbook.md` — remove digest-rotation, superseded-daemon, cross-project merge hazard, and live-lane merge restrictions; upgrades need no operator awareness.
- `v2/docs/install-and-config.md` — stable lifecycle paths and readiness checks.
- `v2/docs/first-workflow-walkthrough.md` — stable auto-start and observation language.
- `v2/docs/tui.md` — one stable connection with unified routed state.
- `v2/docs/v2-architecture.md` — client-to-daemon connection boundary.
- `v2/docs/v1-behaviors.md` — replace client-side keyed discovery and aggregation behavior.
