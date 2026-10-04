# Route `run log` and `run wait` to the owning live daemon

## Problem

`run log` and `run wait` connect only through `withRunClient` to `deps.socketPath` (the invoking digest's socket). After a digest rotation the run's owner is a superseded daemon on a different socket, so the operator cannot tail or block on it. `run list` and the TUI already resolve owners across live daemons; `log`/`wait` do not.

## Decisions

- Resolve the owning socket the same way `run list`/TUI do: query `list` over `discoverLiveDaemonSockets()` ∪ invoking socket, build the `mergeRunLists` `owners` map, pick the owner for the run ID; rules out a bespoke owner lookup.
- Default the resolved socket to `deps.socketPath` when no owner is found; makes solo, no-daemon, and run-absent cases fall through to today's exact single-socket path; rules out inventing a cross-daemon not-found path.
- Route the stream/`wait` to the resolved socket by threading it into `withRunClient` (socket override), not `deps.socketPath`; rules out a second connect helper.
- Skip sockets whose `list` fails during resolution (same skip as `run list`); rules out one dead peer blocking resolution.
- Reuse `mergeRunLists` `isLive` dedupe so a live owner wins over a stale one; rules out returning the first responder.
- No new subcommand or flag; resolution is internal to `run log`/`run wait`.

## Task checklist

- Add a resolver (e.g. `resolveRunOwnerSocket(runId, deps)`) in `v2/src/commands/run.ts` that unions `deps.socketDiscovery` results with `deps.socketPath`, issues `list` per socket (skipping failures), and returns `mergeRunLists(...).owners.get(runId) ?? deps.socketPath`.
- Thread a socket-path override into `withRunClient` (default `deps.socketPath`) so `runLogSubcommand` and the `run wait` branch connect to the resolved socket.
- Call the resolver from `runLogSubcommand` and the `run wait` branch before opening the stream / issuing `wait`.
- Extend the `run list multi-daemon` fixture style in `v2/src/commands/run.test.ts` (per-socket `connectIpcClient` + stubbed `socketDiscovery`) to cover cross-daemon `run log` and `run wait`.

## Acceptance criteria

- [x] `run log` streams a run owned by a non-invoking live daemon (owner reached via discovery); a new `run.test.ts` test asserts the streamed records and fails against the current single-socket path.
- [x] `run wait` resolves a run owned by a non-invoking live daemon; a new `run.test.ts` test asserts the completion payload/exit code and fails against the current single-socket path.
- [x] When only the invoking digest's daemon is live, existing `run.test.ts` `run log` and `run wait` tests stay green (solo output unchanged).
- [x] When no daemon is live at all, existing `run.test.ts` connection-error tests for `run log`/`run wait` stay green (errors unchanged).
- [x] When the run ID is on no queried daemon, the existing `run wait` `unknown_run` test (`"unknown_run: Run run-404 not found\n"`, exit 1) stays green and `run log` still exits 0.
- [x] Inverting the owner-resolution guard (always using `deps.socketPath` instead of the resolved owner) fails a `run log` test and a separate `run wait` test.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — `run log` and `run wait` resolve across live keyed daemons.
- `v2/docs/write-behavior.md` — remove the claim that `run wait` stays single-daemon scoped.
- `v2/docs/v2-architecture.md` — `run log`/`run wait` resolve across live keyed daemons; correct the single-daemon wait claim.
- `v2/docs/operator-runbook.md` § Observe — merge no longer blinds `run log` or `run wait`.
- `v2/docs/v1-behaviors.md` — record `run log`/`run wait` cross-daemon owner resolution.
