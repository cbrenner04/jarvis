# The TUI dies on a daemon bounce instead of reconnecting

## Problem

`jarvis tui` opens one connection at startup (`openTuiDaemonClient`,
`v2/src/tui/tui-daemon-client.ts:72`) and holds it for the session. There is no reconnect: every RPC
throws `RpcConnectionError` once the transport is gone, and `close()` is the only lifecycle hook.

Daemon bounces are routine, not exceptional — the runbook mandates one after merging any v2 change,
and a revision mismatch on a CLI dispatch auto-bounces the daemon underneath a running TUI. Either
way the operator has to notice the TUI is dead, quit, and relaunch it, and loses their view exactly
when a merge or a mismatch means runs are moving.

The same holds for `jarvis tui log <run-id>`: `tui-log-tail-client.ts` throws
`RpcConnectionError` on transport loss with no resumption.

**Priority note (2026-07-21):** the TUI is the operator's live-observation surface — `run list` is
not used for watching work. A TUI that dies on a routine daemon bounce takes away the only live
view. Rank accordingly.

**Interaction with `key-the-daemon-by-executable-digest`:** if daemons become digest-keyed, this is
no longer "reconnect to the same socket" but "track the live set" — the TUI must pick up a
superseding daemon while continuing to render the runs still owned by the superseded one. Land
whichever ships first, but write the reconnect logic so it generalizes to a set of sockets rather
than a single fixed path.

## Decisions

- The monitor reconnects to the daemon socket on transport loss, with bounded backoff, and resumes
  polling once the socket is back — no relaunch.
- While disconnected the TUI shows an explicit reconnecting state rather than a stale table or a
  crash; a bounded exhaustion of retries surfaces a named error and exits.
- After reconnect, the TUI revalidates the daemon revision and keeps the existing refusal on a
  genuine mismatch; reconnect must not paper over a stale-code daemon.
- Log follow resumes the tail after reconnect; pin whether it re-tails from the last observed record
  or restarts the stream in the plan.
- Rules out a supervisor process or auto-restarting the daemon from the TUI.

## Acceptance criteria

- [ ] The monitor survives a daemon stop/start: it enters a visible reconnecting state and resumes
      the live run table without operator action.
- [ ] Reconnect uses bounded backoff and surfaces a named error and non-zero exit when retries are
      exhausted.
- [ ] A revision mismatch observed after reconnect still refuses, as it does at startup.
- [ ] `jarvis tui log <run-id>` resumes its tail after a daemon bounce.
- [ ] Coverage exercises transport loss and recovery through the injected `connectIpcClient` seam,
      asserting rendered output — see `v2/docs/test-writing.md` on TUI tests bypassing the render path.
- [ ] `bun run typecheck`, `test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — TUI behavior across a daemon bounce.
