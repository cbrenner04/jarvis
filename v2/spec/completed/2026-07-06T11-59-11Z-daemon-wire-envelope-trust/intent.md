---
name: daemon-wire-envelope-trust
---

# Daemon wire parsing trusts daemon-produced result shapes

`daemon-wire.ts` parse functions (`parseHealthResult`, `parseStatusResult`, `parseStartResult`, `parseListRuns`, `parseWaitCompletion`) re-validate every field of results the daemon itself produced from the same shared types. Reduce each to a thin envelope check (result object presence plus the minimal shape needed to route the value into its typed result), and stop deep-validating nested fields (e.g. per-row `DaemonListRunRow` fields, workflow step fields) that only ever come from the daemon's own typed state.

## Decisions

- Trust direction: client trusts daemon *response* shapes; the daemon still validates incoming client params.
- `daemon-wire.test.ts` shrinks to envelope-level cases (missing/malformed envelope, present/absent result); deep per-field malformed-payload cases are removed as untestable-by-construction.
- Record the trust decision in `v2-architecture.md` (Interface & IPC) so future wire additions don't reintroduce per-field client validators.
- Add one real-socket integration case to `daemon.sandbox-unrunnable.test.ts`: start a run, then list runs, over the real socket, asserting the thin-checked parse succeeds on genuine daemon output.

## Out of scope

- Wire schema/protocol changes, versioning, handshakes.
- Server-side request validation.
- Changes to callers (`tui-daemon-client.ts`, `tui-log-tail-client.ts`, `cli.ts`).

## Prerequisites
