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
- Make `daemon status` report the serving daemon as `running` even when its loaded executable digest differs from the invoking source, and stop rendering two identifiers that can disagree under a `running` verdict. Today `daemon-lifecycle.ts` decides with `loadedExecutableDigest === currentExecutableDigest` but displays `loadedRevision`/`currentRevision`, which are git `HEAD` commits: observed 2026-09-11 printing `running loaded=a5624c9 current=65f6dab` after a spec-only merge, which provably cannot rotate the key because `EXECUTABLE_TREE_PATHSPECS` covers only `v2/src`, `shared`, and build config. Keeping that pair "as information" is what teaches operators to read normal operation as staleness and bounce for nothing; display the values the decision consumed, or none when they agree. Rules out treating the display as cosmetic while the verdict is correct.
- Make `init --check`, `cleanup --abandon`, run commands, pipeline commands, runtime smoke verification, and TUI clients use the same stable endpoint; rules out surface-specific fallback discovery.
- Delete client-side live-daemon socket enumeration, multi-socket list merging, and owner probing once the stable daemon supplies those views; rules out version coupling returning through a new command.
- Add a structural guard over CLI and command/TUI client layers proving no source digest is computed or digest-keyed socket set enumerated to locate a daemon.

## Acceptance criteria

- [ ] A CLI lifecycle test proves `daemon status` prints `running` and exits zero while a daemon serves the stable socket with a different loaded executable digest; it fails against the pre-fix digest-scoped probe/stale result.
- [ ] A CLI lifecycle test proves `daemon status` never renders two differing identifiers alongside a `running` verdict — the displayed values are the ones the same-or-stale decision consumed, not `HEAD` commits that can differ while the verdict is `running`; it fails against the pre-fix `loadedRevision`/`currentRevision` rendering.
- [ ] Command tests prove `init --check` and `cleanup --abandon` reach a healthy stable daemon after the invoking source changes.
- [ ] End-to-end client tests prove run list/log/wait/kill and every pipeline verb use only the stable socket while still reaching draining-owned work.
- [ ] TUI monitor, log-follow, and steering tests prove one stable connection presents current and draining work without client-side socket discovery or cross-socket ownership maps.
- [ ] A structural test proves production CLI, command, runtime-smoke, and TUI client layers neither compute an executable digest nor enumerate digest-keyed sockets to locate a daemon; it fails against the pre-fix bootstrap and discovery modules.
- [ ] `v2/src/commands/run.test.ts`, `v2/src/commands/pipeline.test.ts`, `v2/src/commands/run-list-dimension-filters.test.ts`, `v2/src/commands/run-list-query-limit-cap.test.ts`, `v2/src/tui/tui-monitor-pipeline-tree.test.ts`, and `v2/src/tui/tui-attention-rows.test.ts` stay green (output/exit-code/filtering/presentation unchanged by the client-resolution change).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — stable daemon CLI, auto-start, run/pipeline routing, TUI connection, and status semantics.
- `v2/docs/operator-runbook.md` — remove digest-rotation, superseded-daemon, cross-project merge hazard, and live-lane merge restrictions; state that upgrades require no operator awareness.
- `v2/docs/install-and-config.md` — stable lifecycle paths and readiness checks.
- `v2/docs/first-workflow-walkthrough.md` — stable auto-start and observation language.
- `v2/docs/tui.md` — one stable daemon connection with unified routed state.
- `v2/docs/v2-architecture.md` — client-to-daemon connection boundary.
- `v2/docs/v1-behaviors.md` — replace client-side keyed discovery and aggregation behavior.
