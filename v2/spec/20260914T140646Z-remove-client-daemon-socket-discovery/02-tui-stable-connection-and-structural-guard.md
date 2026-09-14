# 02 TUI stable connection and client-layer structural guard

## Problem

`v2/src/tui/tui-entry.tsx` and `v2/src/tui/tui-log-follow-entry.tsx` (wired via `v2/src/commands/tui.ts`) discover live digest-keyed sockets, connect to each, and build cross-socket run/pipeline ownership maps (`buildPipelineOwners`, `resolveOwningSocket`) so monitor, log-follow, and steering can reach whichever daemon currently owns a run or pipeline. Nothing prevents a client layer from regaining this pattern once it's removed here and in 00/01.

## Decisions

- TUI holds one stable connection; `tui-entry.tsx`'s and `tui-log-follow-entry.tsx`'s discovery calls, ownership maps, and owner-lookup fallbacks are deleted. Steering and log-follow rely on daemon routing, the same contract 00 and 01 give `cleanup`/`run`.
- No per-command fallback discovery when the stable daemon lacks a route: the TUI surfaces the daemon's own error, matching 00/01.
- Discovery-consumer disposition, by owning subspec:
  - `v2/src/commands/cleanup.ts` — rewritten in 00.
  - `v2/src/commands/run.ts` — rewritten in 01.
  - `v2/src/commands/tui.ts`, `v2/src/tui/tui-entry.tsx`, `v2/src/tui/tui-log-follow-entry.tsx` — rewritten here.
  - `v2/src/cli/deps.ts` — rewritten here: drop the `socketDiscovery` field and its `discoverLiveDaemonSockets` wiring once 00/01/here have no remaining consumer. Its `getExecutableDigest`/`getInvokingExecutableDigest` wiring stays (daemon-handoff plumbing, see 00) and is exempt from the guard below.
  - `v2/src/daemon/pipeline-daemon-resolution.ts` — unchanged; already stable-socket only (see 01).
- Once every consumer above is migrated, delete `v2/src/daemon/live-daemon-socket-discovery.ts` and `v2/src/daemon/query-daemon-lists-from-sockets.ts` — no production consumer will remain, and a dead discovery module invites re-import.
- Structural guard scans production CLI, command, runtime-smoke, and TUI client files (`v2/src/cli.ts`, `v2/src/cli/**`, `v2/src/commands/**`, `v2/src/execution/runtime-smoke-verifier.ts`, `v2/src/tui/**`, excluding `*.test.ts`) for executable-digest computation or digest-keyed-socket enumeration used to locate a daemon. Explicitly exempt: `v2/src/cli.ts`/`v2/src/cli/deps.ts` computing the digest for `daemon start`'s private successor socket, and `v2/src/commands/daemon.ts`/`v2/src/commands/cleanup.ts` reaping dead digest-keyed socket artifacts (deletes files, does not route a command).

## Acceptance criteria

- [x] TUI monitor, log-follow, and steering tests prove one stable connection presents current and draining-owned work without client-side socket discovery or cross-socket ownership maps; they fail against the pre-fix `buildPipelineOwners`/discovery in `v2/src/tui/tui-entry.tsx` and `resolveOwningSocket`/discovery in `v2/src/tui/tui-log-follow-entry.tsx`.
- [x] A test proves the TUI surfaces the daemon's own error when the stable socket lacks a route, with no fallback to discovering another socket.
- [x] A structural test proves the production files listed above neither compute an executable digest nor enumerate digest-keyed sockets to locate a daemon, outside the two exemptions named above; it fails against the pre-fix discovery in `v2/src/tui/tui-entry.tsx`/`v2/src/tui/tui-log-follow-entry.tsx`.
- [x] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` and `v2/src/tui/tui-attention-rows.test.ts` stay green.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/tui.md` — replace the per-socket pipeline-snapshot merge description with one stable connection presenting unified routed state.
- `v2/docs/v2-architecture.md` — client-to-daemon connection boundary.
- `v2/docs/v1-behaviors.md` — replace the TUI per-tick rediscovery/cross-socket ownership-map behavior entries with the stable-connection contract.
