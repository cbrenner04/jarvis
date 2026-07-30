# 00 - Cleanup eligibility across live sockets

## Problem

Bulk `jarvis cleanup` builds its `DaemonClient` from a single connect to the invoking digest socket. After a digest rotation the keyed socket may be absent while a superseded daemon still owns a live run; eligibility then treats merged worktrees as daemon-unreachable instead of live-run blocked. `jarvis run list` already queries `discoverLiveDaemonSockets` ∪ invoking socket.

## Decisions

- Bulk cleanup `list`-based eligibility queries every live socket from `discoverLiveDaemonSockets` ∪ invoking digest socket (same query set as `jarvis run list`); empty discovery still probes only the invoking socket — rules out discovery-only behavior that skips the invoking socket.
- Reuse `discoverLiveDaemonSockets` through `CliDeps.socketDiscovery`; rules out a second discovery implementation.
- Reuse or extract the run-list socket `list` query loop (`queryDaemonListsFromSockets` / `mergeRunLists` pattern in `v2/src/commands/run.ts`); rules out a third per-socket query implementation.
- Probe every socket in the query set; skip a socket whose connect, `list`, or parse fails without failing the whole command — same as `run list`; rules out one dead socket blanking eligibility and rules out aborting on invoking-socket hard errors (`EACCES`, timeout, etc.) when another socket would answer.
- A socket counts as **answering** only when connect + `list` + parse all succeed (same semantics as `run list`); rules out partial failures suppressing or triggering the no-listener stderr incorrectly.
- A live run on the requested `(project, branch)` reported by any successfully queried daemon makes the worktree ineligible — rules out ignoring older-digest daemons when the invoking key has no listener.
- When only the invoking digest's daemon is live, eligibility matches today — rules out regressing the existing matching-key cleanup path.
- Preview and post-confirmation recheck share the same multi-socket union `DaemonClient`; per-socket skip-on-failure applies on recheck; exit nonzero on recheck daemon-unreachable only when **no** socket in the query set answers — rules out divergent recheck wiring.
- Bulk `runCleanupCommand` receives the multi-socket client; `--abandon` and stale-reset `checkWorkflowStartClaim` paths keep today's keyed-socket connect and single-client semantics — rules out widening claim probes to discovery in this slice.
- The no-listener continue stderr from `cleanup-without-listening-daemon` emits only when the full query set has no answering daemon — rules out printing "continuing without daemon" when an older-digest daemon is discovered.
- Deferred to first consumer: multi-socket `checkWorkflowStartClaim` routing when the bulk client surface is later shared beyond eligibility `list` — pin when a caller needs cross-socket claim probes.

## Tasks

- [x] Add a bulk cleanup multi-socket `DaemonClient` factory (list across discovered sockets ∪ invoking socket; union `isLive` matches for `(project, branch)`).
- [x] Wire `cleanup-cli.ts` bulk path to build that client via `deps.socketDiscovery` and `deps.connectIpcClient`; gate the no-listener recovery stderr on an empty answering set.
- [x] Add `older-digest live daemon makes merged worktree ineligible` in `v2/src/commands/cleanup.test.ts` with injectable socket discovery/connect fakes and production guard-inversion hooks.
- [x] Add `one dead socket in query set does not blank eligibility when another reports live run` in `v2/src/commands/cleanup.test.ts` (or extend the older-digest test) with a skip-on-failure guard hook.
- [x] Add `discovered older-digest daemon suppresses no-listener stderr and blocks live run` in `v2/src/commands/cleanup-cli.test.ts`; adapt `continues cleanup when keyed socket has no listener` so it covers true no-listener (empty discovery, no answering socket) only.
- [x] Update documentation listed below.

## Acceptance criteria

- [x] With only a live daemon on an older digest key, bulk `jarvis cleanup` honors a live run it reports; `older-digest live daemon makes merged worktree ineligible` in `v2/src/commands/cleanup.test.ts` fails against the pre-fix single-socket client.
- [x] When the invoking digest socket has no listener but a discovered older-digest socket answers, bulk cleanup does not emit the no-listener continue stderr and a live run on that socket blocks the worktree; `discovered older-digest daemon suppresses no-listener stderr and blocks live run` in `v2/src/commands/cleanup-cli.test.ts` fails against the pre-fix CLI path.
- [x] One dead socket in the query set does not blank eligibility when another socket reports a live run for the same `(project, branch)`; `one dead socket in query set does not blank eligibility when another reports live run` in `v2/src/commands/cleanup.test.ts` fails against the pre-fix path.
- [x] `cleanup-cli.test.ts` `continues cleanup when keyed socket has no listener` stays green for true no-listener (no discovery hit, no answering socket).
- [x] `cleanup.test.ts` `runCleanupCommand rechecks eligibility after confirmation and spares a worktree that went live in the race window` stays green.
- [x] `cleanup.test.ts` `runCleanupCommand exits nonzero when the daemon becomes unreachable during recheck` stays green.
- [x] `cleanup.test.ts` `runCleanupCommand treats a malformed daemon list response as unreachable` stays green.
- [x] `cleanup.test.ts` `runCleanupCommand makes worktree ineligible when daemon client throws` stays green.
- [x] `cleanup.test.ts` `head-only daemon-unreachable skip exits nonzero for dry-run and apply` stays green.
- [x] Inverting `setInvertCleanupSocketDiscoveryForTest` (or equivalent socket-union guard) turns `older-digest live daemon makes merged worktree ineligible` RED; inverting `setInvertCleanupSocketSkipOnFailureForTest` (or equivalent skip-on-failure guard) turns `one dead socket in query set does not blank eligibility when another reports live run` RED.
- [x] `v2/docs/operator-runbook.md` § Cleanup: eligibility gate no longer documents the interim cross-digest gap; multi-socket eligibility discovery is documented.

## Documentation updates

- `v2/docs/daemon-host.md` — bulk cleanup eligibility queries discovered live sockets ∪ invoking socket, not a single keyed connect.
- `v2/docs/operator-runbook.md` § Cleanup: eligibility gate — remove the interim cross-digest gap note; document multi-socket eligibility discovery.
- `v2/docs/v1-behaviors.md` — record cleanup multi-socket eligibility discovery; retire the keyed-only daemon reachability claim.
