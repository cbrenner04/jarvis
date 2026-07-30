# 00 - Cleanup eligibility across live sockets

## Problem

Bulk `jarvis cleanup` builds its `DaemonClient` from a single connect to the invoking digest socket. After a digest rotation the keyed socket may be absent while a superseded daemon still owns a live run; eligibility then treats merged worktrees as daemon-unreachable instead of live-run blocked. `jarvis run list` already queries `discoverLiveDaemonSockets` ∪ invoking socket.

## Decisions

- Bulk cleanup eligibility queries every live socket from `discoverLiveDaemonSockets` ∪ invoking digest socket (same query set as `jarvis run list`); empty discovery still probes only the invoking socket — rules out discovery-only behavior that skips the invoking socket.
- Reuse `discoverLiveDaemonSockets` through `CliDeps.socketDiscovery`; rules out a second discovery implementation.
- Reuse or extract the run-list socket `list` query loop (`queryDaemonListsFromSockets` / `mergeRunLists` pattern in `v2/src/commands/run.ts`); rules out a third per-socket query implementation.
- Skip a socket whose connect or `list` fails without failing the whole command — rules out one dead socket blanking eligibility for all worktrees.
- A live run on the requested `(project, branch)` reported by any successfully queried daemon makes the worktree ineligible — rules out ignoring older-digest daemons when the invoking key has no listener.
- When only the invoking digest's daemon is live, eligibility matches today — rules out regressing the existing matching-key cleanup path.
- Bulk `runCleanupCommand` receives the multi-socket client; `--abandon` keeps today's keyed-socket connect and single-client semantics — rules out widening abandon to discovery in this slice.
- The no-listener continue stderr from `cleanup-without-listening-daemon` emits only when the full query set has no answering daemon — rules out printing "continuing without daemon" when an older-digest daemon is discovered.
- Deferred to first consumer: multi-socket `checkWorkflowStartClaim` routing when the bulk client surface is later shared beyond eligibility `list` — pin when a caller needs cross-socket claim probes.

## Tasks

- [ ] Add a bulk cleanup multi-socket `DaemonClient` factory (list across discovered sockets ∪ invoking socket; union `isLive` matches for `(project, branch)`).
- [ ] Wire `cleanup-cli.ts` bulk path to build that client via `deps.socketDiscovery` and `deps.connectIpcClient`; gate the no-listener recovery stderr on an empty answering set.
- [ ] Add `older-digest live daemon makes merged worktree ineligible` in `v2/src/commands/cleanup.test.ts` with injectable socket discovery/connect fakes and a guard-inversion hook.
- [ ] Update documentation listed below.

## Acceptance criteria

- [ ] With only a live daemon on an older digest key, bulk `jarvis cleanup` honors a live run it reports; `older-digest live daemon makes merged worktree ineligible` in `v2/src/commands/cleanup.test.ts` fails against the pre-fix single-socket client.
- [ ] Matching-key-only daemon: existing cleanup eligibility tests in `v2/src/commands/cleanup.test.ts` stay green without behavior change.
- [ ] Inverting the discovery merge guard turns `older-digest live daemon makes merged worktree ineligible` RED.

## Documentation updates

- `v2/docs/daemon-host.md` — bulk cleanup eligibility queries discovered live sockets ∪ invoking socket, not a single keyed connect.
- `v2/docs/operator-runbook.md` § Cleanup: eligibility gate — remove the interim cross-digest gap note; document multi-socket eligibility discovery.
- `v2/docs/v1-behaviors.md` — record cleanup multi-socket eligibility discovery; retire the keyed-only daemon reachability claim.
