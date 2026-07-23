# `tui log` dies on daemon turnover, and the monitor never replaces its invoking client

## Problem

Re-scoped 2026-07-23 against the code. The original framing ("the TUI dies on a daemon bounce",
one fixed socket, no reconnect) is **obsolete** — `tui-aggregates-live-daemons` (#2010) shipped
live-socket discovery and the run table already survives turnover. Two gaps it did not close remain,
both verified by reading the shipped code.

**1. `jarvis tui log <run-id>` has no discovery and no resume.** `v2/src/commands/tui.ts:19` passes
only `{ socketPath: deps.socketPath }` to the log path — `socketDiscovery` is wired into the bare
`jarvis tui` path (`tui.ts:8-11`) and nothing else. So the log tail targets the invoking digest's
socket alone, which is the same blindness as
`run-list-goes-blind-after-a-merge-rotates-the-digest`, one surface over. On transport loss
`tui-log-tail-client.ts:72-81` converts `"connection closed"` into `RpcConnectionError` and throws
out of the async iterator (`:117`); `tui-log-follow-entry.tsx:71-79` catches it once, renders
`daemon_error`, sets `exitCode = 1`, and returns. There is no retry, no re-open of `records()`, and
no resume cursor — `stream-open` carries only `{ runId }` (`tui-log-tail-client.ts:114`) and the
iterator refuses re-entry after close (`:109-111`).

**2. The monitor never evicts or replaces the client for its invoking socket.**
`tui-entry.tsx:214` force-adds `deps.socketPath` to `allSockets` every tick, so the pruning loop
(`:216-230`) can never drop it, and reconnection only fires for sockets where
`!clients.has(socketPath)` (`:245`). If the daemon behind the invoking socket dies and a new one
binds it, the stale `TuiDaemonClient` stays in the map and its `list()` throws forever — swallowed
at `:282-287` and again by the `.catch(() => {})` at `:379`. There is no per-client liveness
re-probe or failure-count eviction, so the failure is permanent *and* silent: the operator sees a
table that quietly stops including that daemon's runs rather than an error.

Discovery itself is healthy and is not in scope: `live-daemon-socket-discovery.ts:34-61` enumerates
`~/.jarvis/daemon-*.sock`, health-probes each, and `updateConnections` re-runs every 1 s refresh
tick (`tui-entry.tsx:211-253`, `:267-272`), merging and deduping by `isLive` (`:107-125`).

## Decisions

- `jarvis tui log <run-id>` resolves its run across the live keyed daemons, using the **same**
  `discoverLiveDaemonSockets` seam the run table uses. Rules out a second enumeration, and rules out
  requiring the operator to know which digest owns the run.
- The log tail resumes after transport loss with bounded backoff, re-opening the stream against a
  currently-live socket. Records already emitted are not re-emitted: the resumed stream continues
  after the last record the client observed, so `stream-open` must carry a resume cursor. Rules out
  restarting the tail from the beginning, which would duplicate output.
- Retry exhaustion surfaces a named error and a non-zero exit — a silent stop is worse than a
  visible failure. The current single-shot `daemon_error` / exit 1 is the exhausted case, not the
  first failure.
- The monitor treats its invoking socket like any other discovered socket: a client whose RPCs fail
  is evicted and reconnected on a later tick rather than retained forever. Rules out the
  unconditional force-add at `tui-entry.tsx:214` as a permanent exemption from eviction.
- A daemon that has genuinely exited and left no socket is not an error state for the monitor — it
  is eviction, which already works. Only a *failing retained client* is the defect.
- **Out of scope, deliberately:** a reconnecting-state banner and backoff for the run table (the
  1 s re-discovery tick already covers turnover), and any revision-mismatch refusal — the TUI path
  has never had one (`cli.ts:74` registers `tui` without the stale-dispatch wrapper, and
  `tui-entry.tsx:331` discards the `status()` result). The prior version of this seed asserted the
  refusal exists and must be preserved after reconnect; it does not exist. Adding one is separate
  work, not this.

## Acceptance criteria

- [ ] `jarvis tui log <run-id>` tails a run owned by a live daemon on a socket other than the
      invoking digest's; a test fails against the current single-socket path.
- [ ] The log tail survives transport loss: the stream re-opens against a live socket and continues
      without operator action, and no record already emitted is emitted twice.
- [ ] Bounded retries; on exhaustion the command surfaces a named error and exits non-zero.
- [ ] A monitor client for the invoking socket whose RPCs begin failing is evicted and replaced on a
      later refresh tick, and the table again includes that daemon's runs; a test fails against the
      current force-add at `tui-entry.tsx:214`.
- [ ] Eviction of a socket that has genuinely disappeared still works unchanged — the negative case
      proves the fix did not turn absence into an error.
- [ ] Coverage asserts rendered output, not just view-model state — see `v2/docs/test-writing.md` on
      TUI tests bypassing the render path.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — `jarvis tui log` reads across live keyed daemons and
  resumes across turnover; the run table's invoking-socket client is no longer exempt from eviction.
